CREATE TABLE `otp_challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`phone_e164` text NOT NULL,
	`ip_hash` text NOT NULL,
	`code_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`max_attempts` integer NOT NULL,
	`attempts` integer NOT NULL DEFAULT 0,
	`consumed_at` integer,
	`invalidated_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `refresh_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`user_id` text NOT NULL,
	`family_id` text NOT NULL,
	`parent_token_id` text,
	`replaced_by_token_id` text,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`revoked_at` integer,
	`revoked_reason` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `refresh_tokens_token_hash_unique` ON `refresh_tokens` (`token_hash`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`device_id` text NOT NULL,
	`platform` text NOT NULL,
	`created_at` integer NOT NULL,
	`revoked_at` integer
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`phone_e164` text NOT NULL,
	`tenant_id` text NOT NULL,
	`allowed_roles` text NOT NULL,
	`active_role` text NOT NULL,
	`seller_profile_id` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_phone_e164_unique` ON `users` (`phone_e164`);
--> statement-breakpoint
CREATE INDEX `idx_otp_phone_created` ON `otp_challenges` (`phone_e164`, `created_at`);
--> statement-breakpoint
CREATE INDEX `idx_otp_phone_active` ON `otp_challenges` (`phone_e164`, `expires_at`);
--> statement-breakpoint
CREATE INDEX `idx_otp_phone_ip_created` ON `otp_challenges` (`phone_e164`, `ip_hash`, `created_at`);
--> statement-breakpoint
CREATE INDEX `idx_sessions_user_created` ON `sessions` (`user_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX `idx_refresh_family` ON `refresh_tokens` (`family_id`);
--> statement-breakpoint
CREATE INDEX `idx_refresh_session` ON `refresh_tokens` (`session_id`);
--> statement-breakpoint
CREATE INDEX `idx_refresh_user` ON `refresh_tokens` (`user_id`);
