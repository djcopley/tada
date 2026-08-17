CREATE TABLE `activity` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ticket_id` integer,
	`run_id` integer,
	`type` text NOT NULL,
	`message` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `agent_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ticket_id` integer NOT NULL,
	`adapter` text NOT NULL,
	`model` text NOT NULL,
	`effort` text DEFAULT 'medium' NOT NULL,
	`attempt_number` integer DEFAULT 1 NOT NULL,
	`status` text NOT NULL,
	`held_reason` text,
	`hold` text,
	`held_at` integer,
	`budget_ms` integer NOT NULL,
	`summary` text,
	`transcript_path` text,
	`run_token` text NOT NULL,
	`diff_additions` integer,
	`diff_deletions` integer,
	`tests_passed` integer,
	`started_at` integer,
	`finished_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`ticket_id`) REFERENCES `tickets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `comments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ticket_id` integer NOT NULL,
	`run_id` integer,
	`author` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`ticket_id`) REFERENCES `tickets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` integer NOT NULL,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `events_run_id_idx` ON `events` (`run_id`);--> statement-breakpoint
CREATE TABLE `memory_notes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`author` text DEFAULT 'human' NOT NULL,
	`run_id` integer,
	`state` text DEFAULT 'kept' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `push_tokens` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`token` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_tokens_token_unique` ON `push_tokens` (`token`);--> statement-breakpoint
CREATE TABLE `rules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`tool` text NOT NULL,
	`patterns` text DEFAULT '[]' NOT NULL,
	`decision` text NOT NULL,
	`publishes` integer DEFAULT false NOT NULL,
	`position` real NOT NULL,
	`source` text DEFAULT 'human' NOT NULL,
	`source_run_id` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`adapter` text DEFAULT 'claude' NOT NULL,
	`model` text DEFAULT 'sonnet' NOT NULL,
	`effort` text DEFAULT 'medium' NOT NULL,
	`concurrency` integer DEFAULT 2 NOT NULL,
	`timeout_ms` integer DEFAULT 1800000 NOT NULL,
	`ping_channel` text DEFAULT 'push' NOT NULL,
	`reping_ms` integer DEFAULT 3600000 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tickets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`column` text DEFAULT 'backlog' NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`position` real NOT NULL,
	`repo_tags` text DEFAULT '[]' NOT NULL,
	`origin` text DEFAULT 'human' NOT NULL,
	`proposal_state` text,
	`follow_up_of_ticket_id` integer,
	`done_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`follow_up_of_ticket_id`) REFERENCES `tickets`(`id`) ON UPDATE no action ON DELETE set null
);
