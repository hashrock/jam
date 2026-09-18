CREATE TABLE `users` (
  `id` text PRIMARY KEY NOT NULL,
  `email` text NOT NULL,
  `name` text,
  `avatar_url` text,
  `created_at` text NOT NULL
);
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);

CREATE TABLE `api_tokens` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL REFERENCES `users`(`id`),
  `name` text NOT NULL DEFAULT 'default',
  `token_hash` text NOT NULL,
  `created_at` text NOT NULL
);
CREATE UNIQUE INDEX `api_tokens_token_hash_unique` ON `api_tokens` (`token_hash`);

CREATE TABLE `boards` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL REFERENCES `users`(`id`),
  `title` text NOT NULL DEFAULT 'Untitled',
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
CREATE INDEX `boards_user_updated` ON `boards` (`user_id`, `updated_at`);
