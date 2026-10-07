// Export your models here. Add one export per file
// export * from "./posts";
//
// Each model/table should ideally be split into different files.
// Each model/table should define a Drizzle table, insert schema, and types:
//
//   import { pgTable, text, serial } from "drizzle-orm/pg-core";
//   import { createInsertSchema } from "drizzle-zod";
//   import { z } from "zod/v4";
//
//   export const postsTable = pgTable("posts", {
//     id: serial("id").primaryKey(),
//     title: text("title").notNull(),
//   });
//
//   export const insertPostSchema = createInsertSchema(postsTable).omit({ id: true });
//   export type InsertPost = z.infer<typeof insertPostSchema>;
//   export type Post = typeof postsTable.$inferSelect;

import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const commandCenterSettings = pgTable("command_center_settings", {
  id: text("id").primaryKey(),
  difficulty: text("difficulty").notNull().default("000"),
  minerCount: integer("miner_count").notNull().default(1),
  gpuBackend: text("gpu_backend").notNull().default("auto"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});