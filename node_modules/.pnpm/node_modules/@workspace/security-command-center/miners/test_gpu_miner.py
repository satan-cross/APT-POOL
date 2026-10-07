import unittest

from gpu_miner import solve_cpu_multiprocess


class GpuMinerRateTests(unittest.TestCase):
    def test_cpu_fallback_returns_measured_hashes_per_second(self):
        job = {
            "height": 1,
            "previousHash": "0" * 64,
            "workloadId": "rate-test",
            "difficulty": "0",
            "nonceStart": 0,
            "nonceEnd": 20_000,
        }

        nonce, digest, checked, hashes_per_second = solve_cpu_multiprocess(
            job,
            num_processes=2,
        )

        self.assertGreaterEqual(nonce, 0)
        self.assertTrue(digest.startswith("0"))
        self.assertGreaterEqual(checked, nonce + 1)
        self.assertGreater(hashes_per_second, 0)
        self.assertLess(hashes_per_second, 3_500_000_000)

    def test_empty_job_reports_zero_rate(self):
        job = {
            "height": 1,
            "previousHash": "0" * 64,
            "workloadId": "rate-test",
            "difficulty": "0",
            "nonceStart": 0,
            "nonceEnd": 0,
        }

        self.assertEqual(solve_cpu_multiprocess(job), (-1, "", 0, 0.0))


if __name__ == "__main__":
    unittest.main()
