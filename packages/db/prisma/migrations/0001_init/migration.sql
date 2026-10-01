-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UsageKind" AS ENUM ('quick_search', 'deep_research');

-- CreateEnum
CREATE TYPE "AnalysisStatus" AS ENUM ('queued', 'scraping', 'scraped', 'researching', 'analyzing', 'analyzed', 'failed');

-- CreateEnum
CREATE TYPE "ExtractionMode" AS ENUM ('full', 'limited');

-- CreateEnum
CREATE TYPE "ProfileType" AS ENUM ('individual', 'enterprise');

-- CreateEnum
CREATE TYPE "SourcePlatform" AS ENUM ('source_of_sources', 'help_a_b2b_writer', 'sourcebottle', 'haro', 'qwoted', 'mentionmatch', 'pressplugs');

-- CreateEnum
CREATE TYPE "DeepResearchStatus" AS ENUM ('queued', 'running', 'completed', 'cancelled', 'failed', 'truncated', 'low_confidence');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_login_at" TIMESTAMP(3),
    "tier" TEXT NOT NULL DEFAULT 'free',
    "stripe_customer_id" TEXT,
    "stripe_subscription_id" TEXT,
    "stripe_current_period_start" TIMESTAMP(3),
    "stripe_current_period_end" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profiles" (
    "id" TEXT NOT NULL,
    "type" "ProfileType" NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "individual_profiles" (
    "profile_id" TEXT NOT NULL,
    "linkedin_url" TEXT,
    "x_handle" TEXT,
    "free_text_bio" TEXT,
    "x_raw_data" JSONB,
    "expertise_summary" JSONB,

    CONSTRAINT "individual_profiles_pkey" PRIMARY KEY ("profile_id")
);

-- CreateTable
CREATE TABLE "enterprise_profiles" (
    "profile_id" TEXT NOT NULL,
    "company_name" TEXT NOT NULL,
    "company_description" TEXT,
    "website_url" TEXT,
    "docs_url" TEXT,
    "pdf_text" TEXT,
    "website_raw_text" TEXT,
    "company_context" JSONB,
    "last_crawled_at" TIMESTAMP(3),

    CONSTRAINT "enterprise_profiles_pkey" PRIMARY KEY ("profile_id")
);

-- CreateTable
CREATE TABLE "tokens" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analyses" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "status" "AnalysisStatus" NOT NULL DEFAULT 'queued',
    "article_title" TEXT,
    "raw_article_text" TEXT,
    "extraction_mode" "ExtractionMode",
    "score" INTEGER,
    "velocity" TEXT,
    "velocity_reasoning" TEXT,
    "angles" JSONB,
    "why_now" TEXT,
    "pitch" TEXT,
    "drafts" JSONB,
    "error" TEXT,
    "profile_id" TEXT,
    "user_id" TEXT,
    "anon_id" TEXT,
    "research_run_id" TEXT,
    "source_published_at" TIMESTAMP(3),
    "event_timing" TEXT,
    "coverage_signal" JSONB,
    "novelty_score" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "analyses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "llm_calls" (
    "id" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "prompt_tokens" INTEGER NOT NULL,
    "completion_tokens" INTEGER NOT NULL,
    "analysis_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "llm_calls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journalist_requests" (
    "id" TEXT NOT NULL,
    "source_platform" "SourcePlatform" NOT NULL,
    "requester_name" TEXT,
    "outlet" TEXT,
    "topic_text" TEXT NOT NULL,
    "deadline" TIMESTAMP(3),
    "reply_contact" TEXT,
    "raw_email_ref" TEXT,
    "ingested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),

    CONSTRAINT "journalist_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analysis_journalist_matches" (
    "analysis_id" TEXT NOT NULL,
    "journalist_request_id" TEXT NOT NULL,
    "match_rationale" TEXT NOT NULL,
    "matched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analysis_journalist_matches_pkey" PRIMARY KEY ("analysis_id","journalist_request_id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "props" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "anonymous_usage" (
    "id" TEXT NOT NULL,
    "anon_id" TEXT NOT NULL,
    "kind" "UsageKind" NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "first_seen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "anonymous_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_counters" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" "UsageKind" NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "usage_counters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deep_research_runs" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "status" "DeepResearchStatus" NOT NULL DEFAULT 'queued',
    "user_id" TEXT,
    "query" TEXT NOT NULL,
    "depth" INTEGER NOT NULL DEFAULT 2,
    "breadth" INTEGER NOT NULL DEFAULT 3,
    "mode" TEXT NOT NULL DEFAULT 'answer',
    "prepare_session_id" TEXT,
    "skip_clarification" BOOLEAN NOT NULL DEFAULT false,
    "clarification_answers" JSONB,
    "covered_queries" JSONB NOT NULL DEFAULT '[]',
    "learnings" JSONB NOT NULL DEFAULT '[]',
    "sources" JSONB NOT NULL DEFAULT '[]',
    "visited_urls" JSONB NOT NULL DEFAULT '[]',
    "answer" TEXT,
    "report" TEXT,
    "prompt_tokens" INTEGER NOT NULL DEFAULT 0,
    "completion_tokens" INTEGER NOT NULL DEFAULT 0,
    "estimated_cost_usd" DOUBLE PRECISION,
    "error" TEXT,
    "cancelled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deep_research_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deep_research_sessions" (
    "id" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "questions" JSONB NOT NULL,
    "answers" JSONB,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deep_research_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_stripe_customer_id_key" ON "users"("stripe_customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_stripe_subscription_id_key" ON "users"("stripe_subscription_id");

-- CreateIndex
CREATE UNIQUE INDEX "profiles_user_id_key" ON "profiles"("user_id");

-- CreateIndex
CREATE INDEX "analyses_url_profile_id_status_idx" ON "analyses"("url", "profile_id", "status");

-- CreateIndex
CREATE INDEX "analyses_user_id_created_at_idx" ON "analyses"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "analyses_anon_id_created_at_idx" ON "analyses"("anon_id", "created_at");

-- CreateIndex
CREATE INDEX "llm_calls_stage_created_at_idx" ON "llm_calls"("stage", "created_at");

-- CreateIndex
CREATE INDEX "events_name_idx" ON "events"("name");

-- CreateIndex
CREATE UNIQUE INDEX "anonymous_usage_anon_id_kind_key" ON "anonymous_usage"("anon_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "usage_counters_user_id_kind_period_start_key" ON "usage_counters"("user_id", "kind", "period_start");

-- CreateIndex
CREATE UNIQUE INDEX "deep_research_runs_runId_key" ON "deep_research_runs"("runId");

-- CreateIndex
CREATE INDEX "deep_research_runs_status_updated_at_idx" ON "deep_research_runs"("status", "updated_at");

-- AddForeignKey
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "individual_profiles" ADD CONSTRAINT "individual_profiles_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enterprise_profiles" ADD CONSTRAINT "enterprise_profiles_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analyses" ADD CONSTRAINT "analyses_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analyses" ADD CONSTRAINT "analyses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analyses" ADD CONSTRAINT "analyses_research_run_id_fkey" FOREIGN KEY ("research_run_id") REFERENCES "deep_research_runs"("runId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "llm_calls" ADD CONSTRAINT "llm_calls_analysis_id_fkey" FOREIGN KEY ("analysis_id") REFERENCES "analyses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analysis_journalist_matches" ADD CONSTRAINT "analysis_journalist_matches_analysis_id_fkey" FOREIGN KEY ("analysis_id") REFERENCES "analyses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analysis_journalist_matches" ADD CONSTRAINT "analysis_journalist_matches_journalist_request_id_fkey" FOREIGN KEY ("journalist_request_id") REFERENCES "journalist_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_counters" ADD CONSTRAINT "usage_counters_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
