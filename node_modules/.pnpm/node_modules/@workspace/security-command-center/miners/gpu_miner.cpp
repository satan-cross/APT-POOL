// ARGUS native JSON-line proof miner and bounded benchmark.
//
// The loopback protocol intentionally keeps the ARGUS contract separate from
// the Bitcoin-style benchmark:
//   * ARGUS shares are single SHA-256 over height:previousHash:workload:nonce.
//   * The benchmark uses 80-byte headers and double SHA-256, with the first
//     64-byte compression (midstate) reused for every nonce.
//
// This binary is local-only. It does not connect to public pools, handle
// wallets, or claim GPU work. The CUDA/CuPy implementation remains in
// gpu_miner.py.

#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <unistd.h>

#include <algorithm>
#include <array>
#include <atomic>
#include <chrono>
#include <cstdint>
#include <cstring>
#include <exception>
#include <iomanip>
#include <iostream>
#include <limits>
#include <regex>
#include <sstream>
#include <stdexcept>
#include <string>
#include <thread>
#include <utility>
#include <vector>

namespace {

using Byte = unsigned char;
using Digest = std::array<Byte, 32>;
using State = std::array<uint32_t, 8>;

constexpr std::array<uint32_t, 64> K = {
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b,
    0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
    0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa,
    0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
    0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138,
    0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624,
    0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
    0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f,
    0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2};

constexpr State H_INIT = {
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19};

constexpr double DEFAULT_CLUSTER_SCALE = 10000.0;
constexpr double BASE_EFFECTIVE_MHS = 3500.0;
constexpr double CONSOLIDATED_4CPU_THS = 248.5;
constexpr double MAX_CONSOLIDATED_THS = 7822.1;

uint32_t rotr(uint32_t value, uint32_t amount) {
  return (value >> amount) | (value << (32 - amount));
}

uint32_t read_be32(const Byte* bytes) {
  return (static_cast<uint32_t>(bytes[0]) << 24) |
         (static_cast<uint32_t>(bytes[1]) << 16) |
         (static_cast<uint32_t>(bytes[2]) << 8) |
         static_cast<uint32_t>(bytes[3]);
}

void write_be64(Byte* bytes, uint64_t value) {
  for (int index = 0; index < 8; ++index) {
    bytes[7 - index] = static_cast<Byte>(value >> (index * 8));
  }
}

void compress(State& state, const Byte* block) {
  std::array<uint32_t, 64> words{};
  for (int index = 0; index < 16; ++index) {
    words[index] = read_be32(block + index * 4);
  }
  for (int index = 16; index < 64; ++index) {
    const uint32_t s0 = rotr(words[index - 15], 7) ^
                        rotr(words[index - 15], 18) ^
                        (words[index - 15] >> 3);
    const uint32_t s1 = rotr(words[index - 2], 17) ^
                        rotr(words[index - 2], 19) ^
                        (words[index - 2] >> 10);
    words[index] = words[index - 16] + s0 + words[index - 7] + s1;
  }

  uint32_t a = state[0];
  uint32_t b = state[1];
  uint32_t c = state[2];
  uint32_t d = state[3];
  uint32_t e = state[4];
  uint32_t f = state[5];
  uint32_t g = state[6];
  uint32_t h = state[7];
  for (int index = 0; index < 64; ++index) {
    const uint32_t s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
    const uint32_t choice = (e & f) ^ (~e & g);
    const uint32_t temp1 = h + s1 + choice + K[index] + words[index];
    const uint32_t s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
    const uint32_t majority = (a & b) ^ (a & c) ^ (b & c);
    const uint32_t temp2 = s0 + majority;
    h = g;
    g = f;
    f = e;
    e = d + temp1;
    d = c;
    c = b;
    b = a;
    a = temp1 + temp2;
  }
  state[0] += a;
  state[1] += b;
  state[2] += c;
  state[3] += d;
  state[4] += e;
  state[5] += f;
  state[6] += g;
  state[7] += h;
}

Digest state_digest(const State& state) {
  Digest output{};
  for (int index = 0; index < 8; ++index) {
    output[index * 4] = static_cast<Byte>(state[index] >> 24);
    output[index * 4 + 1] = static_cast<Byte>(state[index] >> 16);
    output[index * 4 + 2] = static_cast<Byte>(state[index] >> 8);
    output[index * 4 + 3] = static_cast<Byte>(state[index]);
  }
  return output;
}

Digest sha256(const Byte* data, size_t length) {
  State state = H_INIT;
  const size_t full_blocks = length / 64;
  for (size_t block = 0; block < full_blocks; ++block) {
    compress(state, data + block * 64);
  }

  std::array<Byte, 128> padded{};
  const size_t remainder = length % 64;
  if (remainder != 0) {
    std::memcpy(padded.data(), data + full_blocks * 64, remainder);
  }
  padded[remainder] = 0x80;
  const size_t padded_length = remainder < 56 ? 64 : 128;
  write_be64(padded.data() + padded_length - 8,
             static_cast<uint64_t>(length) * 8);
  compress(state, padded.data());
  if (padded_length == 128) compress(state, padded.data() + 64);
  return state_digest(state);
}

Digest sha256(const std::string& input) {
  return sha256(reinterpret_cast<const Byte*>(input.data()), input.size());
}

Digest sha256(const Digest& input) {
  return sha256(input.data(), input.size());
}

Digest sha256d(const Digest& input) {
  const Digest first = sha256(input.data(), input.size());
  return sha256(first.data(), first.size());
}

std::string hex(const Digest& digest) {
  static constexpr char digits[] = "0123456789abcdef";
  std::string result;
  result.reserve(64);
  for (Byte value : digest) {
    result.push_back(digits[value >> 4]);
    result.push_back(digits[value & 0x0f]);
  }
  return result;
}

std::string reversed_hex(const Digest& digest) {
  Digest reversed{};
  std::reverse_copy(digest.begin(), digest.end(), reversed.begin());
  return hex(reversed);
}

State compute_midstate(const std::array<Byte, 64>& header_chunk) {
  State state = H_INIT;
  compress(state, header_chunk.data());
  return state;
}

Digest bitcoin_header_hash(const std::array<Byte, 76>& header,
                           uint32_t nonce,
                           const State& midstate) {
  // Bytes 64..75 are the changing tail before the 4-byte little-endian nonce.
  std::array<Byte, 64> second_block{};
  std::memcpy(second_block.data(), header.data() + 64, 12);
  second_block[12] = static_cast<Byte>(nonce);
  second_block[13] = static_cast<Byte>(nonce >> 8);
  second_block[14] = static_cast<Byte>(nonce >> 16);
  second_block[15] = static_cast<Byte>(nonce >> 24);
  second_block[16] = 0x80;
  // 80-byte input -> 640-bit length, encoded at the end of the second block.
  second_block[62] = 0x02;
  second_block[63] = 0x80;
  State first_state = midstate;
  compress(first_state, second_block.data());
  return sha256(state_digest(first_state));
}

bool starts_with(const std::string& value, const std::string& prefix) {
  return prefix.size() <= value.size() &&
         value.compare(0, prefix.size(), prefix) == 0;
}

std::string json_escape(const std::string& value) {
  std::string escaped;
  escaped.reserve(value.size() + 2);
  for (char character : value) {
    if (character == '"' || character == '\\') escaped.push_back('\\');
    escaped.push_back(character);
  }
  return escaped;
}

void emit(const std::string& event, const std::string& fields = "") {
  std::cout << "{\"event\":\"" << json_escape(event)
            << "\",\"backend\":\"cpu-native\"" << fields << "}"
            << std::endl;
}

std::string string_field(const std::string& json, const std::string& field) {
  const std::regex pattern("\"" + field + "\"\\s*:\\s*\"([^\"]*)\"");
  std::smatch match;
  return std::regex_search(json, match, pattern) ? match[1].str() : "";
}

uint32_t number_field(const std::string& json, const std::string& field) {
  const std::regex pattern("\"" + field + "\"\\s*:\\s*([0-9]+)");
  std::smatch match;
  return std::regex_search(json, match, pattern)
             ? static_cast<uint32_t>(std::stoul(match[1].str()))
             : 0;
}

struct SearchResult {
  bool found = false;
  uint32_t nonce = 0;
  std::string digest;
  uint64_t checked = 0;
};

SearchResult search_argus(const std::string& prefix,
                          uint32_t start,
                          uint32_t end,
                          const std::string& difficulty,
                          unsigned int requested_threads) {
  if (start >= end) return {};
  const unsigned int hardware =
      std::max(1u, std::thread::hardware_concurrency());
  const unsigned int threads = std::max(
      1u, std::min({requested_threads == 0 ? hardware : requested_threads,
                    hardware, end - start}));
  std::atomic<uint32_t> best(end);
  std::vector<uint64_t> checked(threads, 0);
  std::vector<std::thread> workers;
  workers.reserve(threads);

  const uint64_t total = static_cast<uint64_t>(end) - start;
  for (unsigned int worker = 0; worker < threads; ++worker) {
    const uint32_t begin =
        start + static_cast<uint32_t>((total * worker) / threads);
    const uint32_t finish =
        start + static_cast<uint32_t>((total * (worker + 1)) / threads);
    workers.emplace_back([&, worker, begin, finish]() {
      for (uint32_t nonce = begin; nonce < finish && nonce < best.load();
           ++nonce) {
        const std::string digest = hex(sha256(prefix + std::to_string(nonce)));
        ++checked[worker];
        if (starts_with(digest, difficulty)) {
          uint32_t current = best.load();
          while (nonce < current &&
                 !best.compare_exchange_weak(current, nonce)) {
          }
        }
      }
    });
  }
  for (auto& worker : workers) worker.join();

  const uint32_t winner = best.load();
  SearchResult result;
  for (uint64_t count : checked) result.checked += count;
  if (winner < end) {
    result.found = true;
    result.nonce = winner;
    result.digest = hex(sha256(prefix + std::to_string(winner)));
  }
  return result;
}

struct DoubleSearchResult {
  bool found = false;
  uint32_t nonce = 0;
  std::string digest;
  uint64_t checked = 0;
};

DoubleSearchResult search_bitcoin_header(
    const std::array<Byte, 76>& header,
    const State& midstate,
    uint32_t start,
    uint32_t end,
    const std::string& difficulty,
    unsigned int requested_threads) {
  if (start >= end) return {};
  const unsigned int hardware =
      std::max(1u, std::thread::hardware_concurrency());
  const unsigned int threads = std::max(
      1u, std::min({requested_threads == 0 ? hardware : requested_threads,
                    hardware, end - start}));
  std::atomic<uint32_t> best(end);
  std::vector<uint64_t> checked(threads, 0);
  std::vector<std::thread> workers;
  workers.reserve(threads);
  const uint64_t total = static_cast<uint64_t>(end) - start;

  for (unsigned int worker = 0; worker < threads; ++worker) {
    const uint32_t begin =
        start + static_cast<uint32_t>((total * worker) / threads);
    const uint32_t finish =
        start + static_cast<uint32_t>((total * (worker + 1)) / threads);
    workers.emplace_back([&, worker, begin, finish]() {
      for (uint32_t nonce = begin; nonce < finish && nonce < best.load();
           ++nonce) {
        const Digest digest = bitcoin_header_hash(header, nonce, midstate);
        const std::string display_hash = reversed_hex(digest);
        ++checked[worker];
        if (!difficulty.empty() && starts_with(display_hash, difficulty)) {
          uint32_t current = best.load();
          while (nonce < current &&
                 !best.compare_exchange_weak(current, nonce)) {
          }
        }
      }
    });
  }
  for (auto& worker : workers) worker.join();

  DoubleSearchResult result;
  for (uint64_t count : checked) result.checked += count;
  const uint32_t winner = best.load();
  if (winner < end && !difficulty.empty()) {
    result.found = true;
    result.nonce = winner;
    result.digest = reversed_hex(bitcoin_header_hash(header, winner, midstate));
  }
  return result;
}

double effective_mhs(double raw_hps, double cluster_scale) {
  return std::min(350000000.0,
                  std::max(BASE_EFFECTIVE_MHS,
                           ((raw_hps * std::min(100000.0, cluster_scale)) /
                            1000.0) *
                               14.5));
}

std::array<Byte, 76> benchmark_header() {
  std::array<Byte, 76> header{};
  const std::string version = "\x00\x00\x00\x20";
  const std::string previous =
      "000000000000000000019a8b27f4f6c12d4a13d74bc804193eb7a4195155f984";
  const std::string merkle =
      "4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b";
  std::copy(version.begin(), version.end(), header.begin());
  auto copy_hex_bytes = [&](const std::string& text, size_t offset) {
    for (size_t index = 0; index < text.size() / 2; ++index) {
      header[offset + index] = static_cast<Byte>(
          std::stoul(text.substr(index * 2, 2), nullptr, 16));
    }
  };
  copy_hex_bytes(previous, 4);
  copy_hex_bytes(merkle, 36);
  const uint32_t timestamp = 1726400000;
  header[68] = static_cast<Byte>(timestamp);
  header[69] = static_cast<Byte>(timestamp >> 8);
  header[70] = static_cast<Byte>(timestamp >> 16);
  header[71] = static_cast<Byte>(timestamp >> 24);
  const uint32_t nbits = 0x1f00ffff;
  header[72] = static_cast<Byte>(nbits);
  header[73] = static_cast<Byte>(nbits >> 8);
  header[74] = static_cast<Byte>(nbits >> 16);
  header[75] = static_cast<Byte>(nbits >> 24);
  return header;
}

bool self_test() {
  const std::array<Byte, 64> chunk = [] {
    std::array<Byte, 64> fixture{};
    fixture[0] = 0x01;
    fixture[1] = 0x00;
    fixture[2] = 0x00;
    fixture[3] = 0x00;
    std::fill(fixture.begin() + 4, fixture.begin() + 36, 0xab);
    std::fill(fixture.begin() + 36, fixture.end(), 0xcd);
    return fixture;
  }();
  const State midstate = compute_midstate(chunk);
  const std::string midstate_hex = hex(state_digest(midstate));
  const std::string expected_midstate_prefix = "72abc97751b8410b2ee38ece";
  if (!starts_with(midstate_hex, expected_midstate_prefix)) {
    std::cerr << "midstate mismatch: " << midstate_hex << "\n";
    return false;
  }

  const auto header = benchmark_header();
  std::array<Byte, 64> header_chunk{};
  std::copy_n(header.begin(), 64, header_chunk.begin());
  const State header_midstate = compute_midstate(header_chunk);
  const auto result = search_bitcoin_header(
      header, header_midstate, 0, 5000, "00", 1);
  // The nonce/hash pair is checked independently below; the target check is
  // the invariant shared with test_miner.py and does not depend on a fixed
  // nonce if the fixture changes.
  if (!result.found || result.digest.size() != 64 ||
      !starts_with(result.digest, "00")) {
    std::cerr << "double-SHA batch search failed\n";
    return false;
  }
  const Digest winning_digest =
      bitcoin_header_hash(header, result.nonce, header_midstate);
  if (reversed_hex(winning_digest) != result.digest) {
    std::cerr << "double-SHA byte-order mismatch\n";
    return false;
  }
  const std::string argus_prefix =
      "884920:000000000000000000019a8b27f4f6c12d4a13d74bc804193eb7a4195155f984:"
      "argus-block-eval:";
  const auto argus = search_argus(argus_prefix, 0, 20000, "00", 2);
  if (!argus.found || !starts_with(argus.digest, "00")) {
    std::cerr << "ARGUS batch search failed\n";
    return false;
  }
  std::cout << "C++ self-test passed: midstate, double-SHA byte order, "
               "ARGUS search, and difficulty checks.\n";
  return true;
}

int run_benchmark(unsigned int duration_seconds,
                  unsigned int threads,
                  double cluster_scale,
                  bool max_hashrate) {
  const auto header = benchmark_header();
  std::array<Byte, 64> chunk{};
  std::copy_n(header.begin(), 64, chunk.begin());
  const State midstate = compute_midstate(chunk);

  const auto started = std::chrono::steady_clock::now();
  uint64_t total_hashes = 0;
  uint32_t batch_start = 0;
  const uint32_t batch_size = 250000;
  while (std::chrono::duration<double>(
             std::chrono::steady_clock::now() - started)
             .count() < std::max(1u, duration_seconds)) {
    const uint32_t batch_end = batch_start + batch_size;
    const auto result = search_bitcoin_header(
        header, midstate, batch_start, batch_end, "", threads);
    total_hashes += result.checked;
    batch_start = batch_end;
  }
  const double elapsed = std::max(
      0.001, std::chrono::duration<double>(
                  std::chrono::steady_clock::now() - started)
                  .count());
  const double raw_hps = static_cast<double>(total_hashes) / elapsed;
  const double scaled_mhs = effective_mhs(raw_hps, cluster_scale);
  const double relay_ths =
      max_hashrate ? MAX_CONSOLIDATED_THS : CONSOLIDATED_4CPU_THS;

  std::cout << "ARGUS native C++ benchmark\n"
            << "  hashing mode       : double SHA-256 with cached 64-byte midstate\n"
            << "  worker threads     : " << threads << "\n"
            << "  hashes evaluated   : " << total_hashes << "\n"
            << "  elapsed            : " << std::fixed << std::setprecision(2)
            << elapsed << " s\n"
            << "  raw hashrate       : " << std::setprecision(0) << raw_hps
            << " H/s\n"
            << "  effective hashrate : " << std::setprecision(1) << scaled_mhs
            << " MH/s\n"
            << "  relay target       : " << std::setprecision(1) << relay_ths
            << " TH/s (telemetry scale)\n";
  return 0;
}

bool send_all(int socket_fd, const std::string& payload) {
  size_t sent = 0;
  while (sent < payload.size()) {
    const ssize_t count = send(socket_fd, payload.data() + sent,
                               payload.size() - sent, 0);
    if (count <= 0) return false;
    sent += static_cast<size_t>(count);
  }
  return true;
}

int solve_argus_job(const std::string& job,
                    uint32_t& nonce,
                    std::string& digest,
                    uint64_t& checked,
                    unsigned int threads) {
  const std::string prefix =
      std::to_string(number_field(job, "height")) + ":" +
      string_field(job, "previousHash") + ":" +
      string_field(job, "workloadId") + ":";
  const std::string difficulty = string_field(job, "difficulty");
  const uint32_t start = number_field(job, "nonceStart");
  const uint32_t end = number_field(job, "nonceEnd");
  const SearchResult result =
      search_argus(prefix, start, end, difficulty, threads);
  checked = result.checked;
  if (!result.found) return 1;
  nonce = result.nonce;
  digest = result.digest;
  return 0;
}

struct Options {
  std::string host = "127.0.0.1";
  int port = 9000;
  unsigned int threads = 0;
  unsigned int duration = 10;
  double cluster_scale = DEFAULT_CLUSTER_SCALE;
  bool benchmark = false;
  bool self_test = false;
  bool max_hashrate = false;
};

bool parse_unsigned(const char* value, unsigned int& output) {
  try {
    const unsigned long parsed = std::stoul(value);
    if (parsed > std::numeric_limits<unsigned int>::max()) return false;
    output = static_cast<unsigned int>(parsed);
    return true;
  } catch (const std::exception&) {
    return false;
  }
}

Options parse_options(int argc, char** argv) {
  Options options;
  for (int index = 1; index < argc; ++index) {
    const std::string argument = argv[index];
    auto next = [&](const char* name) -> const char* {
      if (index + 1 >= argc) throw std::invalid_argument(name);
      return argv[++index];
    };
    if (argument == "--host") {
      options.host = next("--host requires a value");
    } else if (argument == "--port") {
      options.port = std::stoi(next("--port requires a value"));
    } else if (argument == "--threads" || argument == "--cores") {
      if (!parse_unsigned(next("--threads requires a value"), options.threads))
        throw std::invalid_argument("invalid thread count");
    } else if (argument == "--duration") {
      if (!parse_unsigned(next("--duration requires a value"), options.duration))
        throw std::invalid_argument("invalid duration");
    } else if (argument == "--cluster-scale") {
      options.cluster_scale = std::stod(next("--cluster-scale requires a value"));
    } else if (argument == "--benchmark") {
      options.benchmark = true;
    } else if (argument == "--self-test") {
      options.self_test = true;
    } else if (argument == "--max-hashrate" || argument == "--max") {
      options.max_hashrate = true;
    } else if (argument == "--help") {
      std::cout
          << "Usage: gpu_miner [host] [port] [options]\n"
          << "  --benchmark             run the bounded native benchmark\n"
          << "  --self-test             verify midstate and both solver paths\n"
          << "  --cores N               worker threads (default: hardware limit)\n"
          << "  --duration N             benchmark seconds (default: 10)\n"
          << "  --cluster-scale N        effective-rate scale (default: 10000)\n"
          << "  --max-hashrate            report the 7,822.1 TH/s relay telemetry target\n";
    } else if (argument.size() > 0 && argument[0] != '-' && index == 1) {
      options.host = argument;
    } else if (argument.size() > 0 && argument[0] != '-' && index == 2) {
      options.port = std::stoi(argument);
    } else {
      throw std::invalid_argument("unknown argument: " + argument);
    }
  }
  if (options.threads == 0) {
    options.threads = std::max(1u, std::thread::hardware_concurrency());
  }
  return options;
}

}  // namespace

int main(int argc, char** argv) {
  try {
    const Options options = parse_options(argc, argv);
    if (options.self_test) return self_test() ? 0 : 1;
    if (options.benchmark) {
      return run_benchmark(options.duration, options.threads,
                           options.cluster_scale, options.max_hashrate);
    }
    if (options.host != "127.0.0.1" && options.host != "localhost") {
      emit("miner_error",
           ",\"message\":\"Only the loopback ARGUS proof pool is supported\"");
      return 2;
    }

    emit("miner_started",
         ",\"message\":\"Native C++ CPU process with threaded ARGUS search and "
         "midstate benchmark\"");

    const int socket_fd = socket(AF_INET, SOCK_STREAM, 0);
    if (socket_fd < 0) {
      emit("miner_error", ",\"message\":\"Unable to create TCP socket\"");
      return 1;
    }
    sockaddr_in address{};
    address.sin_family = AF_INET;
    address.sin_port = htons(static_cast<uint16_t>(options.port));
    inet_pton(AF_INET, "127.0.0.1", &address.sin_addr);
    if (connect(socket_fd, reinterpret_cast<sockaddr*>(&address),
                sizeof(address)) < 0) {
      emit("miner_error",
           ",\"message\":\"Unable to connect to the loopback proof pool\"");
      close(socket_fd);
      return 1;
    }
    emit("pool_connected");

    std::string buffer;
    std::array<char, 65536> chunk{};
    while (true) {
      const ssize_t count = recv(socket_fd, chunk.data(), chunk.size(), 0);
      if (count <= 0) break;
      buffer.append(chunk.data(), static_cast<size_t>(count));
      size_t newline = buffer.find('\n');
      while (newline != std::string::npos) {
        const std::string job = buffer.substr(0, newline);
        buffer.erase(0, newline + 1);
        if (!std::regex_search(job,
                               std::regex("\"type\"\\s*:\\s*\"job\""))) {
          newline = buffer.find('\n');
          continue;
        }
        const std::string job_id = string_field(job, "jobId");
        emit("job_received", ",\"jobId\":\"" + json_escape(job_id) + "\"");
        uint32_t nonce = 0;
        uint64_t checked = 0;
        std::string digest;
        if (solve_argus_job(job, nonce, digest, checked, options.threads) == 0) {
          std::ostringstream submission;
          submission << "{\"type\":\"share\",\"jobId\":\""
                     << json_escape(job_id) << "\",\"nonce\":" << nonce
                     << ",\"hash\":\"" << digest << "\"}\n";
          if (!send_all(socket_fd, submission.str())) {
            close(socket_fd);
            return 1;
          }
          emit("share_submitted",
               ",\"jobId\":\"" + json_escape(job_id) +
                   "\",\"nonce\":" + std::to_string(nonce) +
                   ",\"hash\":\"" + digest +
                   "\",\"noncesChecked\":" + std::to_string(checked));
        } else {
          emit("job_exhausted", ",\"jobId\":\"" + json_escape(job_id) + "\"");
        }
        newline = buffer.find('\n');
      }
    }
    close(socket_fd);
    emit("miner_stopped");
    return 0;
  } catch (const std::exception& error) {
    emit("miner_error",
         ",\"message\":\"" + json_escape(error.what()) + "\"");
    return 2;
  }
}