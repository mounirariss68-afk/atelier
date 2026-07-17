--
-- PostgreSQL database dump
--

\restrict 4Naqryb23skxm6cE2nFgMqoYBXyejlpfGakuNknsC0PkILRbeCoITPZDlnFwTcM

-- Dumped from database version 16.10
-- Dumped by pg_dump version 16.10

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: pg_trgm; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;


--
-- Name: EXTENSION pg_trgm; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION pg_trgm IS 'text similarity measurement and index searching based on trigrams';


--
-- Name: vector; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;


--
-- Name: EXTENSION vector; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION vector IS 'vector data type and ivfflat and hnsw access methods';


--
-- Name: atelier_breakglass(text, text, text, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.atelier_breakglass(p_target_table text, p_target_id text, p_sensitivity text, p_reason text) RETURNS text
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_role  text := atelier_user_role();
  v_uid   text := COALESCE(NULLIF(current_setting('app.user_id', true), ''), '');
  v_org   text := atelier_current_org();
  v_id    text;
BEGIN
  IF v_role NOT IN ('founding_partner','partner') THEN
    RAISE EXCEPTION 'breakglass requires partner-tier role (got %)', v_role
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_sensitivity NOT IN ('compensation','personnel_contract') THEN
    RAISE EXCEPTION 'invalid sensitivity_class: %', p_sensitivity;
  END IF;
  IF coalesce(trim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'breakglass reason is required';
  END IF;
  v_id := 'po_' || to_hex((extract(epoch FROM clock_timestamp()) * 1000000)::bigint)
              || '_' || to_hex((random() * 9223372036854775807)::bigint);
  INSERT INTO atelier_principle_override
    (id, org_id, actor_user_id, actor_role, target_table, target_id,
     sensitivity_class, reason, granted_at, expires_at)
  VALUES
    (v_id, v_org, v_uid, v_role, p_target_table, p_target_id,
     p_sensitivity, p_reason, now(), now() + interval '15 minutes');
  PERFORM set_config('app.principle_override', 'true', true);
  RETURN v_id;
END;
$$;


ALTER FUNCTION public.atelier_breakglass(p_target_table text, p_target_id text, p_sensitivity text, p_reason text) OWNER TO postgres;

--
-- Name: atelier_caller_person_ids(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.atelier_caller_person_ids() RETURNS text[]
    LANGUAGE sql STABLE
    AS $$
  WITH uid AS (
    SELECT COALESCE(NULLIF(current_setting('app.user_id', true), ''), '') AS v
  )
  SELECT COALESCE(array_agg(pid) FILTER (WHERE pid IS NOT NULL), ARRAY[]::text[])
  FROM (
    SELECT e.id AS pid FROM atelier_employees e, uid
      WHERE e.user_id = uid.v AND uid.v <> ''
    UNION
    SELECT c.id AS pid FROM atelier_contractors c, atelier_users u, uid
      WHERE u.id = uid.v AND uid.v <> '' AND lower(c.email) = lower(u.email)
  ) s;
$$;


ALTER FUNCTION public.atelier_caller_person_ids() OWNER TO postgres;

--
-- Name: atelier_can_view_comp(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.atelier_can_view_comp() RETURNS boolean
    LANGUAGE sql STABLE
    AS $$ SELECT atelier_principle_override_active() OR atelier_user_role() IN ('founding_partner','partner','finance'); $$;


ALTER FUNCTION public.atelier_can_view_comp() OWNER TO postgres;

--
-- Name: atelier_can_view_contract_value(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.atelier_can_view_contract_value() RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  SELECT current_setting('app.user_role', true) IN
    ('founding_partner', 'partner', 'finance', 'compliance_officer');
$$;


ALTER FUNCTION public.atelier_can_view_contract_value() OWNER TO postgres;

--
-- Name: atelier_can_view_personnel(text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.atelier_can_view_personnel(owner_user_id text) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  SELECT
    atelier_principle_override_active()
    OR atelier_user_role() IN ('founding_partner','partner','hr')
    OR (owner_user_id IS NOT NULL
        AND owner_user_id = COALESCE(NULLIF(current_setting('app.user_id', true), ''), ''));
$$;


ALTER FUNCTION public.atelier_can_view_personnel(owner_user_id text) OWNER TO postgres;

--
-- Name: atelier_current_org(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.atelier_current_org() RETURNS text
    LANGUAGE sql STABLE
    AS $$
  SELECT COALESCE(NULLIF(current_setting('app.org_id', true), ''), 'aico');
$$;


ALTER FUNCTION public.atelier_current_org() OWNER TO postgres;

--
-- Name: atelier_engagement_allowed(text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.atelier_engagement_allowed(eng_id text) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  SELECT
    COALESCE(NULLIF(current_setting('app.engagement_ids', true), ''), '') = ''
    OR eng_id = ANY (string_to_array(current_setting('app.engagement_ids', true), ','));
$$;


ALTER FUNCTION public.atelier_engagement_allowed(eng_id text) OWNER TO postgres;

--
-- Name: atelier_l2c_engagement_allowed(text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.atelier_l2c_engagement_allowed(eng_id text) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  SELECT
    -- Org isolation.
    eng_id IS NOT NULL
    AND (
      -- Firm-wide allow-list: leadership + finance + compliance_officer.
      current_setting('app.user_role', true) IN (
        'founding_partner', 'partner', 'finance', 'compliance_officer'
      )
      OR
      -- Senior manager / consultant / hr: must have explicit grant.
      eng_id = ANY (
        string_to_array(
          COALESCE(NULLIF(current_setting('app.engagement_ids', true), ''), ''),
          ','
        )
      )
    );
$$;


ALTER FUNCTION public.atelier_l2c_engagement_allowed(eng_id text) OWNER TO postgres;

--
-- Name: atelier_principle_override_active(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.atelier_principle_override_active() RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  SELECT COALESCE(NULLIF(current_setting('app.principle_override', true), ''), '') = 'true';
$$;


ALTER FUNCTION public.atelier_principle_override_active() OWNER TO postgres;

--
-- Name: atelier_user_role(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.atelier_user_role() RETURNS text
    LANGUAGE sql STABLE
    AS $$
  SELECT COALESCE(NULLIF(current_setting('app.user_role', true), ''), '');
$$;


ALTER FUNCTION public.atelier_user_role() OWNER TO postgres;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: arcelik_calendar; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.arcelik_calendar (
    id text NOT NULL,
    brand text NOT NULL,
    campaign_name text NOT NULL,
    start_month integer NOT NULL,
    end_month integer NOT NULL,
    categories jsonb NOT NULL,
    type text NOT NULL
);


ALTER TABLE public.arcelik_calendar OWNER TO postgres;

--
-- Name: arcelik_campaigns; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.arcelik_campaigns (
    id text NOT NULL,
    name text NOT NULL,
    target_segment text NOT NULL,
    eligible_categories jsonb NOT NULL,
    promotion_type text NOT NULL,
    discount_detail text NOT NULL,
    headline text NOT NULL,
    body_copy text NOT NULL,
    messaging_tone text NOT NULL,
    target_cities jsonb NOT NULL,
    duration_pattern text NOT NULL,
    projected_impact jsonb NOT NULL,
    banner_description text NOT NULL,
    dealer_pos_messaging text NOT NULL,
    dealer_sms_notification text NOT NULL
);


ALTER TABLE public.arcelik_campaigns OWNER TO postgres;

--
-- Name: arcelik_cities; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.arcelik_cities (
    id text NOT NULL,
    name text NOT NULL,
    population_tier text NOT NULL,
    market_share_percent double precision NOT NULL,
    avg_price_index double precision NOT NULL,
    competitor_strength jsonb NOT NULL,
    seasonal_pattern text NOT NULL,
    dealer_count integer NOT NULL
);


ALTER TABLE public.arcelik_cities OWNER TO postgres;

--
-- Name: arcelik_competitor_prices; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.arcelik_competitor_prices (
    id text NOT NULL,
    brand text NOT NULL,
    competitor_model text NOT NULL,
    category text NOT NULL,
    competitor_price integer NOT NULL,
    arcelik_equivalent_id text NOT NULL,
    price_delta_percent double precision NOT NULL,
    positioning text NOT NULL,
    note text NOT NULL,
    source_id text NOT NULL,
    price_date text NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    data_provenance text DEFAULT 'manual-verified'::text NOT NULL,
    scraped_at text
);


ALTER TABLE public.arcelik_competitor_prices OWNER TO postgres;

--
-- Name: arcelik_data_sources; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.arcelik_data_sources (
    id text NOT NULL,
    category text NOT NULL,
    name text NOT NULL,
    name_en text NOT NULL,
    source_type text NOT NULL,
    source_url text NOT NULL,
    source_date text NOT NULL,
    description text NOT NULL,
    description_en text NOT NULL
);


ALTER TABLE public.arcelik_data_sources OWNER TO postgres;

--
-- Name: arcelik_dealers; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.arcelik_dealers (
    id text NOT NULL,
    store_name text NOT NULL,
    city text NOT NULL,
    district text NOT NULL,
    tier text NOT NULL,
    compliance_score integer NOT NULL,
    monthly_sales_target integer NOT NULL,
    current_progress integer NOT NULL,
    earned_commission integer NOT NULL,
    product_mix jsonb NOT NULL,
    stock_levels jsonb NOT NULL,
    pending_orders integer NOT NULL,
    last_order_date text NOT NULL
);


ALTER TABLE public.arcelik_dealers OWNER TO postgres;

--
-- Name: arcelik_kpi_benchmarks; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.arcelik_kpi_benchmarks (
    id text NOT NULL,
    label text NOT NULL,
    value text NOT NULL,
    target text NOT NULL
);


ALTER TABLE public.arcelik_kpi_benchmarks OWNER TO postgres;

--
-- Name: arcelik_marketplace_price_history; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.arcelik_marketplace_price_history (
    id integer NOT NULL,
    marketplace text NOT NULL,
    marketplace_product_id text NOT NULL,
    brand text NOT NULL,
    category text NOT NULL,
    price integer NOT NULL,
    previous_price integer,
    price_change_percent double precision,
    arcelik_product_id text,
    scrape_run_id text NOT NULL,
    recorded_at timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.arcelik_marketplace_price_history OWNER TO postgres;

--
-- Name: arcelik_marketplace_price_history_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.arcelik_marketplace_price_history_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.arcelik_marketplace_price_history_id_seq OWNER TO postgres;

--
-- Name: arcelik_marketplace_price_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.arcelik_marketplace_price_history_id_seq OWNED BY public.arcelik_marketplace_price_history.id;


--
-- Name: arcelik_marketplace_prices; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.arcelik_marketplace_prices (
    id integer NOT NULL,
    marketplace text NOT NULL,
    marketplace_product_id text NOT NULL,
    product_url text NOT NULL,
    brand text NOT NULL,
    title text NOT NULL,
    category text NOT NULL,
    price integer NOT NULL,
    capacity_liters integer,
    capacity_kg double precision,
    energy_class text,
    arcelik_product_id text,
    competitor_price_id text,
    match_confidence double precision,
    scraped_at timestamp without time zone DEFAULT now() NOT NULL,
    scrape_run_id text NOT NULL
);


ALTER TABLE public.arcelik_marketplace_prices OWNER TO postgres;

--
-- Name: arcelik_marketplace_prices_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.arcelik_marketplace_prices_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.arcelik_marketplace_prices_id_seq OWNER TO postgres;

--
-- Name: arcelik_marketplace_prices_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.arcelik_marketplace_prices_id_seq OWNED BY public.arcelik_marketplace_prices.id;


--
-- Name: arcelik_price_history; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.arcelik_price_history (
    id integer NOT NULL,
    record_type text NOT NULL,
    reference_id text NOT NULL,
    brand text NOT NULL,
    model_code text NOT NULL,
    price integer NOT NULL,
    previous_price integer,
    price_change_percent double precision,
    source text NOT NULL,
    scrape_run_id text NOT NULL,
    recorded_at timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.arcelik_price_history OWNER TO postgres;

--
-- Name: arcelik_price_history_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.arcelik_price_history_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.arcelik_price_history_id_seq OWNER TO postgres;

--
-- Name: arcelik_price_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.arcelik_price_history_id_seq OWNED BY public.arcelik_price_history.id;


--
-- Name: arcelik_product_equivalences; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.arcelik_product_equivalences (
    id integer NOT NULL,
    arcelik_product_id text NOT NULL,
    competitor_brand text NOT NULL,
    competitor_model text NOT NULL,
    competitor_marketplace_id integer,
    competitor_price_record_id text,
    match_confidence double precision NOT NULL,
    match_basis jsonb NOT NULL,
    source text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.arcelik_product_equivalences OWNER TO postgres;

--
-- Name: arcelik_product_equivalences_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.arcelik_product_equivalences_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.arcelik_product_equivalences_id_seq OWNER TO postgres;

--
-- Name: arcelik_product_equivalences_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.arcelik_product_equivalences_id_seq OWNED BY public.arcelik_product_equivalences.id;


--
-- Name: arcelik_product_specs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.arcelik_product_specs (
    id integer NOT NULL,
    marketplace_price_id integer NOT NULL,
    marketplace text NOT NULL,
    marketplace_product_id text NOT NULL,
    capacity_liters integer,
    capacity_kg double precision,
    energy_class text,
    product_type text,
    width_cm double precision,
    height_cm double precision,
    depth_cm double precision,
    noise_level_db integer,
    spin_rpm integer,
    raw_specs jsonb,
    extracted_at timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.arcelik_product_specs OWNER TO postgres;

--
-- Name: arcelik_product_specs_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.arcelik_product_specs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.arcelik_product_specs_id_seq OWNER TO postgres;

--
-- Name: arcelik_product_specs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.arcelik_product_specs_id_seq OWNED BY public.arcelik_product_specs.id;


--
-- Name: arcelik_products; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.arcelik_products (
    id text NOT NULL,
    model_code text NOT NULL,
    name text NOT NULL,
    category text NOT NULL,
    subcategory text NOT NULL,
    price_tier text NOT NULL,
    tsf_price integer NOT NULL,
    dealer_cost integer NOT NULL,
    margin_percent double precision NOT NULL,
    energy_class text NOT NULL,
    features jsonb NOT NULL,
    source_id text NOT NULL,
    price_date text NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    data_provenance text DEFAULT 'manual-verified'::text NOT NULL,
    scraped_at text
);


ALTER TABLE public.arcelik_products OWNER TO postgres;

--
-- Name: arcelik_scrape_logs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.arcelik_scrape_logs (
    id text NOT NULL,
    trigger text NOT NULL,
    status text NOT NULL,
    started_at timestamp without time zone DEFAULT now() NOT NULL,
    completed_at timestamp without time zone,
    scraped_counts jsonb,
    matched_products integer,
    matched_competitors integer,
    total_products integer,
    total_competitors integer,
    error_message text,
    health_status text,
    health_alerts jsonb,
    geo_warning_counts jsonb
);


ALTER TABLE public.arcelik_scrape_logs OWNER TO postgres;

--
-- Name: assessment_submissions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.assessment_submissions (
    id integer NOT NULL,
    public_id text NOT NULL,
    slug text NOT NULL,
    overall_score double precision NOT NULL,
    tier text NOT NULL,
    sovereign_score double precision DEFAULT 0 NOT NULL,
    language text DEFAULT 'en'::text NOT NULL,
    profile jsonb NOT NULL,
    answers jsonb NOT NULL,
    use_cases jsonb,
    result jsonb NOT NULL,
    memo text,
    team_token text,
    team_role text,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.assessment_submissions OWNER TO postgres;

--
-- Name: assessment_submissions_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.assessment_submissions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.assessment_submissions_id_seq OWNER TO postgres;

--
-- Name: assessment_submissions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.assessment_submissions_id_seq OWNED BY public.assessment_submissions.id;


--
-- Name: atelier_account_actions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_account_actions (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    account_id text NOT NULL,
    title text NOT NULL,
    detail text,
    owner_id text,
    status text DEFAULT 'open'::text NOT NULL,
    priority text DEFAULT 'medium'::text NOT NULL,
    due_date text,
    linked_objective_id text,
    linked_play text,
    source text DEFAULT 'manual'::text NOT NULL,
    source_ref text,
    completed_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);

ALTER TABLE ONLY public.atelier_account_actions FORCE ROW LEVEL SECURITY;


ALTER TABLE public.atelier_account_actions OWNER TO postgres;

--
-- Name: atelier_account_goal_progress; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_account_goal_progress (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    account_id text NOT NULL,
    objective_id text NOT NULL,
    current_value text,
    status text DEFAULT 'on_track'::text NOT NULL,
    note text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);

ALTER TABLE ONLY public.atelier_account_goal_progress FORCE ROW LEVEL SECURITY;


ALTER TABLE public.atelier_account_goal_progress OWNER TO postgres;

--
-- Name: atelier_account_insights; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_account_insights (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    account_id text NOT NULL,
    author_id text NOT NULL,
    body text NOT NULL,
    category text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);

ALTER TABLE ONLY public.atelier_account_insights FORCE ROW LEVEL SECURITY;


ALTER TABLE public.atelier_account_insights OWNER TO postgres;

--
-- Name: atelier_account_risks; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_account_risks (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    account_id text NOT NULL,
    kind text DEFAULT 'risk'::text NOT NULL,
    severity text DEFAULT 'amber'::text NOT NULL,
    owner_id text,
    status text DEFAULT 'open'::text NOT NULL,
    due_date text,
    description text NOT NULL,
    mitigation text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);

ALTER TABLE ONLY public.atelier_account_risks FORCE ROW LEVEL SECURITY;


ALTER TABLE public.atelier_account_risks OWNER TO postgres;

--
-- Name: atelier_account_team_members; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_account_team_members (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    account_id text NOT NULL,
    user_id text NOT NULL,
    role_on_account text DEFAULT 'contributor'::text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);

ALTER TABLE ONLY public.atelier_account_team_members FORCE ROW LEVEL SECURITY;


ALTER TABLE public.atelier_account_team_members OWNER TO postgres;

--
-- Name: atelier_accounts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_accounts (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    name text NOT NULL,
    country text NOT NULL,
    sector text NOT NULL,
    notes text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone,
    parent_account_id text,
    size text,
    hq_city text,
    primary_currency text DEFAULT 'USD'::text NOT NULL,
    primary_language text DEFAULT 'en'::text NOT NULL,
    tier text DEFAULT 'C'::text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    partner_owner_id text,
    relationship_strength double precision DEFAULT 0 NOT NULL,
    enriched_at timestamp without time zone,
    source_signals jsonb DEFAULT '[]'::jsonb NOT NULL,
    strategic_priorities jsonb DEFAULT '[]'::jsonb NOT NULL,
    cognirise_hypothesis text,
    pending_profile_updates jsonb DEFAULT '[]'::jsonb NOT NULL,
    brand_name text,
    strategic_priority_refs jsonb DEFAULT '[]'::jsonb NOT NULL,
    country_code text,
    industry_code text,
    sub_industry_code text,
    research_brief jsonb,
    account_strategy jsonb,
    competitors jsonb DEFAULT '[]'::jsonb NOT NULL,
    employee_count integer,
    annual_revenue jsonb,
    holding_structure jsonb,
    country_presence jsonb DEFAULT '[]'::jsonb NOT NULL,
    entity_role text
);

ALTER TABLE ONLY public.atelier_accounts FORCE ROW LEVEL SECURITY;


ALTER TABLE public.atelier_accounts OWNER TO postgres;

--
-- Name: atelier_activities; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_activities (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    account_id text NOT NULL,
    parent_type text DEFAULT 'account'::text NOT NULL,
    parent_id text NOT NULL,
    type text DEFAULT 'task'::text NOT NULL,
    title text NOT NULL,
    body text,
    owner_id text,
    due_date text,
    status text DEFAULT 'open'::text NOT NULL,
    completed_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_activities OWNER TO postgres;

--
-- Name: atelier_admin_settings; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_admin_settings (
    org_id text NOT NULL,
    value jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.atelier_admin_settings OWNER TO postgres;

--
-- Name: atelier_agent_deployments; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_agent_deployments (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    agent_id text NOT NULL,
    agent_name text NOT NULL,
    version text NOT NULL,
    environment text NOT NULL,
    rollout_strategy text DEFAULT ''::text NOT NULL,
    traffic_pct integer DEFAULT 0 NOT NULL,
    persona_binding text DEFAULT ''::text NOT NULL,
    promoted_by text NOT NULL,
    promoted_at text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_agent_deployments OWNER TO postgres;

--
-- Name: atelier_agent_designs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_agent_designs (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    engagement_id text NOT NULL,
    process_step_id text,
    design jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);

ALTER TABLE ONLY public.atelier_agent_designs FORCE ROW LEVEL SECURITY;


ALTER TABLE public.atelier_agent_designs OWNER TO postgres;

--
-- Name: atelier_agent_eval_suites; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_agent_eval_suites (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    name text NOT NULL,
    agent_id text NOT NULL,
    agent_name text NOT NULL,
    kind text NOT NULL,
    case_count integer DEFAULT 0 NOT NULL,
    pass_rate double precision DEFAULT 0 NOT NULL,
    last_run_at text NOT NULL,
    owned_by text NOT NULL,
    rubric text DEFAULT ''::text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_agent_eval_suites OWNER TO postgres;

--
-- Name: atelier_agent_incidents; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_agent_incidents (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    agent_id text NOT NULL,
    agent_name text NOT NULL,
    title text NOT NULL,
    severity text NOT NULL,
    detected_at text NOT NULL,
    status text NOT NULL,
    cluster text DEFAULT ''::text NOT NULL,
    root_cause text,
    proposed_change text DEFAULT ''::text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone,
    evidence_run_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    fix_version_id text
);


ALTER TABLE public.atelier_agent_incidents OWNER TO postgres;

--
-- Name: atelier_agent_retirements; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_agent_retirements (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    agent_id text NOT NULL,
    agent_name text NOT NULL,
    reason text DEFAULT ''::text NOT NULL,
    replacement_agent_id text,
    replacement_name text,
    deprecate_at text NOT NULL,
    archive_at text NOT NULL,
    status text NOT NULL,
    callers_to_migrate integer DEFAULT 0 NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_agent_retirements OWNER TO postgres;

--
-- Name: atelier_agent_runs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_agent_runs (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    agent_id text NOT NULL,
    triggered_by_user_id text,
    target_type text,
    target_id text,
    target_label text,
    inputs jsonb DEFAULT '{}'::jsonb NOT NULL,
    output jsonb,
    steps jsonb DEFAULT '[]'::jsonb NOT NULL,
    tool_calls jsonb DEFAULT '[]'::jsonb NOT NULL,
    human_decisions jsonb DEFAULT '[]'::jsonb NOT NULL,
    confidence text,
    status text DEFAULT 'running'::text NOT NULL,
    status_message text,
    progress_pct integer,
    sources_count integer,
    cost_usd double precision,
    duration_ms integer,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);

ALTER TABLE ONLY public.atelier_agent_runs FORCE ROW LEVEL SECURITY;


ALTER TABLE public.atelier_agent_runs OWNER TO postgres;

--
-- Name: atelier_agent_specs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_agent_specs (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    name text NOT NULL,
    intent text DEFAULT ''::text NOT NULL,
    group_name text DEFAULT ''::text NOT NULL,
    status text NOT NULL,
    owner text NOT NULL,
    forked_from text,
    tools jsonb DEFAULT '[]'::jsonb NOT NULL,
    guardrails jsonb DEFAULT '[]'::jsonb NOT NULL,
    persona_binding text DEFAULT ''::text NOT NULL,
    review_log jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at text NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_agent_specs OWNER TO postgres;

--
-- Name: atelier_agent_versions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_agent_versions (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    agent_id text NOT NULL,
    agent_name text NOT NULL,
    version text NOT NULL,
    status text NOT NULL,
    change_summary text DEFAULT ''::text NOT NULL,
    prompt_delta text DEFAULT ''::text NOT NULL,
    tools_added jsonb DEFAULT '[]'::jsonb NOT NULL,
    tools_removed jsonb DEFAULT '[]'::jsonb NOT NULL,
    author text NOT NULL,
    committed_at text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_agent_versions OWNER TO postgres;

--
-- Name: atelier_agents; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_agents (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    name text NOT NULL,
    group_name text NOT NULL,
    stage text NOT NULL,
    purpose text NOT NULL,
    model text NOT NULL,
    starred boolean DEFAULT false NOT NULL,
    status text DEFAULT 'registered'::text NOT NULL,
    tools jsonb DEFAULT '[]'::jsonb NOT NULL,
    guardrails jsonb DEFAULT '[]'::jsonb NOT NULL,
    human_checkpoints jsonb DEFAULT '[]'::jsonb NOT NULL,
    runs_last_30d integer DEFAULT 0 NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone,
    inputs jsonb DEFAULT '[]'::jsonb NOT NULL,
    outputs jsonb DEFAULT '[]'::jsonb NOT NULL
);

ALTER TABLE ONLY public.atelier_agents FORCE ROW LEVEL SECURITY;


ALTER TABLE public.atelier_agents OWNER TO postgres;

--
-- Name: atelier_alliance_certifications; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_alliance_certifications (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    credential text NOT NULL,
    platform text NOT NULL,
    holder text NOT NULL,
    status text NOT NULL,
    expires_at text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_alliance_certifications OWNER TO postgres;

--
-- Name: atelier_alliance_conflicts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_alliance_conflicts (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    headline text NOT NULL,
    partner_firm text NOT NULL,
    detected_at text NOT NULL,
    severity text NOT NULL,
    detail text DEFAULT ''::text NOT NULL,
    recommendation text DEFAULT ''::text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_alliance_conflicts OWNER TO postgres;

--
-- Name: atelier_alliance_joint_pipeline; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_alliance_joint_pipeline (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    opportunity_name text NOT NULL,
    client text NOT NULL,
    partner_firm text NOT NULL,
    lead_party text NOT NULL,
    stage text NOT NULL,
    acv_usd_k integer DEFAULT 0 NOT NULL,
    cognirise_pct integer DEFAULT 0 NOT NULL,
    partner_pct integer DEFAULT 0 NOT NULL,
    split_rationale text DEFAULT ''::text NOT NULL,
    alliance_letter_status text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_alliance_joint_pipeline OWNER TO postgres;

--
-- Name: atelier_alliance_partner_firms; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_alliance_partner_firms (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    name text NOT NULL,
    kind text NOT NULL,
    country text NOT NULL,
    speciality text DEFAULT ''::text NOT NULL,
    relationship_strength integer DEFAULT 0 NOT NULL,
    anchor_cognirise text DEFAULT ''::text NOT NULL,
    anchor_partner text DEFAULT ''::text NOT NULL,
    last_touch_at text,
    open_joint_opps integer DEFAULT 0 NOT NULL,
    lifetime_joint_revenue_mm double precision DEFAULT 0 NOT NULL,
    recent_moves jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_alliance_partner_firms OWNER TO postgres;

--
-- Name: atelier_artifacts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_artifacts (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    parent_type text NOT NULL,
    parent_id text NOT NULL,
    file_url text,
    title text NOT NULL,
    abstract text,
    tags jsonb DEFAULT '[]'::jsonb NOT NULL,
    source text DEFAULT 'upload'::text NOT NULL,
    atelier_promoted boolean DEFAULT false NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone,
    body text,
    language text DEFAULT 'en'::text NOT NULL,
    translated_title text,
    translated_body text,
    translated_at timestamp without time zone
);

ALTER TABLE ONLY public.atelier_artifacts FORCE ROW LEVEL SECURITY;


ALTER TABLE public.atelier_artifacts OWNER TO postgres;

--
-- Name: atelier_assets; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_assets (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    kind text NOT NULL,
    title text NOT NULL,
    abstract text NOT NULL,
    body_or_file_url text,
    provenance text NOT NULL,
    tags jsonb DEFAULT '[]'::jsonb NOT NULL,
    promoted_from_engagement_id text,
    promoted_by_user_id text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone,
    industry_codes jsonb DEFAULT '[]'::jsonb NOT NULL
);

ALTER TABLE ONLY public.atelier_assets FORCE ROW LEVEL SECURITY;


ALTER TABLE public.atelier_assets OWNER TO postgres;

--
-- Name: atelier_audit_events; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_audit_events (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    entity_type text NOT NULL,
    entity_id text NOT NULL,
    actor_type text NOT NULL,
    actor_id text,
    actor_label text NOT NULL,
    action text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    payload_summary text,
    ts timestamp without time zone DEFAULT now() NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);

ALTER TABLE ONLY public.atelier_audit_events FORCE ROW LEVEL SECURITY;


ALTER TABLE public.atelier_audit_events OWNER TO postgres;

--
-- Name: atelier_auth_credentials; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_auth_credentials (
    email text NOT NULL,
    user_id text NOT NULL,
    password_hash text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    user_managed boolean DEFAULT false NOT NULL,
    must_change_password boolean DEFAULT false NOT NULL,
    disabled boolean DEFAULT false NOT NULL,
    must_change_reason text
);


ALTER TABLE public.atelier_auth_credentials OWNER TO postgres;

--
-- Name: atelier_auth_sessions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_auth_sessions (
    token_hash text NOT NULL,
    user_id text NOT NULL,
    email text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    expires_at timestamp without time zone NOT NULL,
    must_change_password boolean DEFAULT false NOT NULL
);


ALTER TABLE public.atelier_auth_sessions OWNER TO postgres;

--
-- Name: atelier_bank_account; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_bank_account (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    legal_entity_id text,
    bank_name text NOT NULL,
    account_label text NOT NULL,
    account_number_last4 text NOT NULL,
    currency text DEFAULT 'USD'::text NOT NULL,
    opening_balance double precision DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_bank_account OWNER TO postgres;

--
-- Name: atelier_bank_change_requests; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_bank_change_requests (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    person_type text NOT NULL,
    person_id text NOT NULL,
    requested_by_user_id text NOT NULL,
    previous_iban_masked text,
    new_iban text NOT NULL,
    new_swift text,
    reason text,
    status text DEFAULT 'pending'::text NOT NULL,
    decided_by_user_id text,
    decided_by_name text,
    decided_at timestamp without time zone,
    decision_note text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_bank_change_requests OWNER TO postgres;

--
-- Name: atelier_bank_recon_period; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_bank_recon_period (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    bank_account_id text NOT NULL,
    period_label text NOT NULL,
    period_start text NOT NULL,
    period_end text NOT NULL,
    opening_balance double precision DEFAULT 0 NOT NULL,
    closing_balance double precision DEFAULT 0 NOT NULL,
    computed_receipts double precision DEFAULT 0 NOT NULL,
    computed_payments double precision DEFAULT 0 NOT NULL,
    variance double precision DEFAULT 0 NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    finalised_at timestamp without time zone,
    finalised_by_user_id text,
    approved_by_user_id text,
    rationale_text text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_bank_recon_period OWNER TO postgres;

--
-- Name: atelier_bank_statement_import; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_bank_statement_import (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    bank_account_id text NOT NULL,
    statement_date text NOT NULL,
    source text DEFAULT 'csv'::text NOT NULL,
    file_url text,
    file_hash text NOT NULL,
    rows_count integer DEFAULT 0 NOT NULL,
    imported_at timestamp without time zone DEFAULT now() NOT NULL,
    imported_by text,
    notes text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_bank_statement_import OWNER TO postgres;

--
-- Name: atelier_bank_transaction; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_bank_transaction (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    bank_account_id text NOT NULL,
    statement_import_id text NOT NULL,
    posted_date text NOT NULL,
    amount double precision NOT NULL,
    currency text DEFAULT 'USD'::text NOT NULL,
    counterparty_name_raw text,
    reference_raw text,
    kind text DEFAULT 'receipt'::text NOT NULL,
    matched_state text DEFAULT 'unmatched'::text NOT NULL,
    match_run_id text,
    notes text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_bank_transaction OWNER TO postgres;

--
-- Name: atelier_briefs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_briefs (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    opportunity_id text NOT NULL,
    run_id text,
    account_snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
    buyer_landscape jsonb DEFAULT '{}'::jsonb NOT NULL,
    five_c_draft jsonb DEFAULT '{}'::jsonb NOT NULL,
    open_questions jsonb DEFAULT '[]'::jsonb NOT NULL,
    citations jsonb DEFAULT '[]'::jsonb NOT NULL,
    confidence text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone,
    status text DEFAULT 'draft'::text NOT NULL,
    approved_at timestamp without time zone,
    approved_by_user_id text
);


ALTER TABLE public.atelier_briefs OWNER TO postgres;

--
-- Name: atelier_calendar_events; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_calendar_events (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    person_id text NOT NULL,
    person_type text DEFAULT 'employee'::text NOT NULL,
    title text NOT NULL,
    starts_at timestamp without time zone NOT NULL,
    ends_at timestamp without time zone NOT NULL,
    duration_mins integer NOT NULL,
    attendees jsonb DEFAULT '[]'::jsonb NOT NULL,
    engagement_hint text,
    source_provider text DEFAULT 'synthetic'::text NOT NULL,
    source_event_id text,
    raw_payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_calendar_events OWNER TO postgres;

--
-- Name: atelier_capability_embeddings; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_capability_embeddings (
    capability_id text NOT NULL,
    tool_name text NOT NULL,
    summary_text text NOT NULL,
    provider text NOT NULL,
    dim integer NOT NULL,
    vec jsonb NOT NULL,
    schema_hash text NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.atelier_capability_embeddings OWNER TO postgres;

--
-- Name: atelier_cash_application; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_cash_application (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    cash_receipt_id text NOT NULL,
    invoice_id text NOT NULL,
    applied_amount double precision NOT NULL,
    currency text DEFAULT 'USD'::text NOT NULL,
    applied_at timestamp without time zone DEFAULT now() NOT NULL,
    applied_by_user_id text,
    approved_by_user_id text,
    reverses_application_id text,
    reversal_reason text,
    rationale_text text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_cash_application OWNER TO postgres;

--
-- Name: atelier_cash_audit; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_cash_audit (
    id text NOT NULL,
    ts timestamp with time zone DEFAULT now() NOT NULL,
    actor text NOT NULL,
    action text NOT NULL,
    target text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL
);


ALTER TABLE public.atelier_cash_audit OWNER TO postgres;

--
-- Name: atelier_cash_forecast_snapshot; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_cash_forecast_snapshot (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    snapshot_id text NOT NULL,
    snapshot_at timestamp without time zone DEFAULT now() NOT NULL,
    bank_account_id text,
    week_index integer NOT NULL,
    week_start text NOT NULL,
    expected_in double precision DEFAULT 0 NOT NULL,
    expected_out double precision DEFAULT 0 NOT NULL,
    opening_balance double precision DEFAULT 0 NOT NULL,
    closing_balance double precision DEFAULT 0 NOT NULL,
    confidence_low double precision DEFAULT 0 NOT NULL,
    confidence_high double precision DEFAULT 0 NOT NULL,
    is_cash_gap boolean DEFAULT false NOT NULL,
    currency text DEFAULT 'USD'::text NOT NULL,
    input_evidence_ref text NOT NULL,
    computed_by_agent_run_id text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_cash_forecast_snapshot OWNER TO postgres;

--
-- Name: atelier_cash_line_overrides; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_cash_line_overrides (
    line_id text NOT NULL,
    locked_amount double precision,
    locked_date text,
    locked boolean DEFAULT false NOT NULL,
    note text DEFAULT ''::text NOT NULL,
    by_user_id text NOT NULL,
    by_user_name text NOT NULL,
    by_role text NOT NULL,
    at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.atelier_cash_line_overrides OWNER TO postgres;

--
-- Name: atelier_cash_receipt; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_cash_receipt (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    bank_transaction_id text NOT NULL,
    customer_id text,
    total_amount double precision NOT NULL,
    applied_amount double precision DEFAULT 0 NOT NULL,
    currency text DEFAULT 'USD'::text NOT NULL,
    received_at text NOT NULL,
    notes text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_cash_receipt OWNER TO postgres;

--
-- Name: atelier_change_order; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_change_order (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    engagement_id text NOT NULL,
    parent_contract_id text,
    contract_id text,
    kind text NOT NULL,
    summary text NOT NULL,
    rationale_text text DEFAULT ''::text NOT NULL,
    old_value_json jsonb DEFAULT 'null'::jsonb,
    new_value_json jsonb DEFAULT 'null'::jsonb,
    value_delta_usd double precision DEFAULT 0 NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    proposed_by_user_id text,
    partner_approver_user_id text,
    partner_approved_at timestamp without time zone,
    client_proposed_at timestamp without time zone,
    client_resolved_at timestamp without time zone,
    client_signer_name text DEFAULT ''::text NOT NULL,
    client_signer_email text DEFAULT ''::text NOT NULL,
    evidence_url text DEFAULT ''::text NOT NULL,
    posted_at timestamp without time zone,
    linked_raid_id text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone,
    labour_hours_delta double precision DEFAULT 0 NOT NULL,
    labour_cost_delta_usd double precision DEFAULT 0 NOT NULL,
    expenses_delta_usd double precision DEFAULT 0 NOT NULL,
    subs_delta_usd double precision DEFAULT 0 NOT NULL
);


ALTER TABLE public.atelier_change_order OWNER TO postgres;

--
-- Name: atelier_charter_versions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_charter_versions (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    engagement_id text NOT NULL,
    version_number integer NOT NULL,
    run_id text,
    body jsonb DEFAULT '{}'::jsonb NOT NULL,
    hypothesis_tree jsonb DEFAULT '{}'::jsonb NOT NULL,
    raid_baseline jsonb DEFAULT '[]'::jsonb NOT NULL,
    proposed_workstreams jsonb DEFAULT '[]'::jsonb NOT NULL,
    mece_flags jsonb DEFAULT '[]'::jsonb NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    lead_approved_at timestamp without time zone,
    lead_approved_by_user_id text,
    partner_approved_at timestamp without time zone,
    partner_approved_by_user_id text,
    partner_approved_by_name text,
    notes text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_charter_versions OWNER TO postgres;

--
-- Name: atelier_clause; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_clause (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    family text NOT NULL,
    title text NOT NULL,
    body text NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    parent_id text,
    jurisdiction_tags jsonb DEFAULT '[]'::jsonb NOT NULL,
    instrument_types jsonb DEFAULT '[]'::jsonb NOT NULL,
    risk_tier text DEFAULT 'low'::text NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    published_at timestamp without time zone,
    published_by_user_id text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_clause OWNER TO postgres;

--
-- Name: atelier_clause_acceptance; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_clause_acceptance (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    counterparty_id text NOT NULL,
    clause_id text NOT NULL,
    contract_id text,
    accepted_at timestamp without time zone NOT NULL,
    customizations_json jsonb DEFAULT 'null'::jsonb,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_clause_acceptance OWNER TO postgres;

--
-- Name: atelier_cli_attachments; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_cli_attachments (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    user_id text NOT NULL,
    session_id text,
    turn_id text,
    file_name text NOT NULL,
    mime text NOT NULL,
    size_bytes integer NOT NULL,
    sha256 text NOT NULL,
    encrypted_ref text NOT NULL,
    status text DEFAULT 'uploaded'::text NOT NULL,
    rejection_reason text,
    intent_hint text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_cli_attachments OWNER TO postgres;

--
-- Name: atelier_cli_jobs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_cli_jobs (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    turn_id text NOT NULL,
    session_id text NOT NULL,
    user_id text NOT NULL,
    kind text NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    input jsonb,
    result jsonb,
    error text,
    progress jsonb DEFAULT 'null'::jsonb,
    step_results jsonb DEFAULT '[]'::jsonb NOT NULL,
    expiry timestamp without time zone,
    idempotency_key text NOT NULL,
    started_at timestamp without time zone,
    finished_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.atelier_cli_jobs FORCE ROW LEVEL SECURITY;


ALTER TABLE public.atelier_cli_jobs OWNER TO postgres;

--
-- Name: atelier_cli_sessions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_cli_sessions (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    user_id text NOT NULL,
    title text,
    rolling_summary text DEFAULT ''::text NOT NULL,
    recent_turn_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    page_context_snapshot jsonb DEFAULT 'null'::jsonb,
    spent_cents_today integer DEFAULT 0 NOT NULL,
    spent_cents_day text,
    turn_count integer DEFAULT 0 NOT NULL,
    last_turn_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);

ALTER TABLE ONLY public.atelier_cli_sessions FORCE ROW LEVEL SECURITY;


ALTER TABLE public.atelier_cli_sessions OWNER TO postgres;

--
-- Name: atelier_cli_turns; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_cli_turns (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    session_id text NOT NULL,
    user_id text NOT NULL,
    status text DEFAULT 'streaming'::text NOT NULL,
    status_message text,
    prompt text NOT NULL,
    attachment_refs jsonb DEFAULT '[]'::jsonb NOT NULL,
    page_context jsonb DEFAULT 'null'::jsonb,
    intent text,
    plan_json jsonb,
    frames jsonb DEFAULT '[]'::jsonb NOT NULL,
    tool_calls jsonb DEFAULT '[]'::jsonb NOT NULL,
    pending_write jsonb,
    dry_run boolean DEFAULT false NOT NULL,
    client_turn_key text,
    cost_cents integer DEFAULT 0 NOT NULL,
    tokens_in integer DEFAULT 0 NOT NULL,
    tokens_out integer DEFAULT 0 NOT NULL,
    model text,
    latency_ms integer DEFAULT 0 NOT NULL,
    last_step_idx integer DEFAULT 0 NOT NULL,
    step_results jsonb DEFAULT '[]'::jsonb NOT NULL,
    finished_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    feedback jsonb,
    recording_trace jsonb
);

ALTER TABLE ONLY public.atelier_cli_turns FORCE ROW LEVEL SECURITY;


ALTER TABLE public.atelier_cli_turns OWNER TO postgres;

--
-- Name: atelier_compliance_records; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_compliance_records (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    person_type text,
    person_id text,
    partner_firm_id text,
    kind text NOT NULL,
    jurisdiction text,
    reference_number_redacted text,
    reference_number_last_four text,
    issued_date text,
    expiry_date text,
    status text DEFAULT 'active'::text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    notes text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone,
    encrypted_at_rest boolean DEFAULT true NOT NULL,
    jurisdiction_country_code text
);


ALTER TABLE public.atelier_compliance_records OWNER TO postgres;

--
-- Name: atelier_conflict_disclosures; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_conflict_disclosures (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    person_type text NOT NULL,
    person_id text NOT NULL,
    disclosure_text text NOT NULL,
    disclosed_at timestamp without time zone DEFAULT now() NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    notes text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone,
    declared_party text,
    nature text,
    scope_impact text,
    declared_at timestamp without time zone DEFAULT now(),
    last_reviewed_at timestamp without time zone
);


ALTER TABLE public.atelier_conflict_disclosures OWNER TO postgres;

--
-- Name: atelier_contact_relationships; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_contact_relationships (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    account_id text NOT NULL,
    from_contact_id text NOT NULL,
    to_contact_id text NOT NULL,
    type text NOT NULL,
    notes text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_contact_relationships OWNER TO postgres;

--
-- Name: atelier_contacts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_contacts (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    account_id text NOT NULL,
    full_name text NOT NULL,
    title text,
    seniority text,
    email text,
    phone text,
    linkedin_url text,
    buyer_persona text,
    influence_score integer DEFAULT 3 NOT NULL,
    disposition text DEFAULT 'unknown'::text NOT NULL,
    last_contact_at timestamp without time zone,
    contact_owner_id text,
    notes text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone,
    source_url text,
    confidence text DEFAULT 'inferred'::text NOT NULL,
    relationship_strength integer DEFAULT 0 NOT NULL,
    next_touch_at timestamp without time zone,
    relationship_trend jsonb DEFAULT '[]'::jsonb NOT NULL,
    time_in_role text,
    career_history jsonb DEFAULT '[]'::jsonb NOT NULL,
    education jsonb DEFAULT '[]'::jsonb NOT NULL,
    entity_name text,
    entity_scope text
);


ALTER TABLE public.atelier_contacts OWNER TO postgres;

--
-- Name: atelier_contract; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_contract (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    instrument_type text NOT NULL,
    parent_contract_id text,
    counterparty_id text NOT NULL,
    engagement_id text,
    opportunity_id text,
    title text NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    governing_law text DEFAULT ''::text NOT NULL,
    currency text DEFAULT 'USD'::text NOT NULL,
    contract_value double precision DEFAULT 0 NOT NULL,
    contract_value_usd double precision DEFAULT 0 NOT NULL,
    term_start text,
    term_end text,
    payment_terms_days integer DEFAULT 30 NOT NULL,
    po_number text DEFAULT ''::text NOT NULL,
    bill_to_json jsonb DEFAULT 'null'::jsonb,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    fully_executed_at timestamp without time zone,
    terminated_at timestamp without time zone,
    termination_reason text DEFAULT ''::text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_contract OWNER TO postgres;

--
-- Name: atelier_contract_clause; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_contract_clause (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    contract_id text NOT NULL,
    clause_id text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    customizations_json jsonb DEFAULT 'null'::jsonb,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_contract_clause OWNER TO postgres;

--
-- Name: atelier_contract_party; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_contract_party (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    contract_id text NOT NULL,
    counterparty_id text,
    internal_user_id text,
    role_on_contract text NOT NULL,
    signer_name text NOT NULL,
    signer_email text NOT NULL,
    signer_title text DEFAULT ''::text NOT NULL,
    sign_state text DEFAULT 'pending'::text NOT NULL,
    sign_method text DEFAULT 'docusign'::text NOT NULL,
    sent_at timestamp without time zone,
    signed_at timestamp without time zone,
    sign_evidence_url text DEFAULT ''::text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_contract_party OWNER TO postgres;

--
-- Name: atelier_contract_redline; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_contract_redline (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    contract_id text NOT NULL,
    contract_version_id text NOT NULL,
    clause_id text,
    proposed_body text NOT NULL,
    diff_json jsonb DEFAULT 'null'::jsonb,
    risk_tier text DEFAULT 'low'::text NOT NULL,
    risk_commentary text DEFAULT ''::text NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    resolved_at timestamp without time zone,
    resolved_by_user_id text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_contract_redline OWNER TO postgres;

--
-- Name: atelier_contract_version; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_contract_version (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    contract_id text NOT NULL,
    version integer NOT NULL,
    rendered_body text NOT NULL,
    body_hash text NOT NULL,
    snapshot_reason text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text
);


ALTER TABLE public.atelier_contract_version OWNER TO postgres;

--
-- Name: atelier_contractor_payments; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_contractor_payments (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    payee_user_id text NOT NULL,
    payee_person_type text DEFAULT 'contractor'::text NOT NULL,
    payee_name text NOT NULL,
    engagement_id text NOT NULL,
    week_iso text NOT NULL,
    hours double precision DEFAULT 0 NOT NULL,
    rate_per_hour double precision DEFAULT 0 NOT NULL,
    rate_currency text DEFAULT 'USD'::text NOT NULL,
    cost_amount double precision DEFAULT 0 NOT NULL,
    cost_currency text DEFAULT 'USD'::text NOT NULL,
    fx_rate double precision DEFAULT 1 NOT NULL,
    usd_amount double precision DEFAULT 0 NOT NULL,
    status text DEFAULT 'proposed'::text NOT NULL,
    requires_partner_approval boolean DEFAULT false NOT NULL,
    proposal_run_id text,
    evidence_entry_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    notes text,
    partner_approved_by_user_id text,
    partner_approved_at timestamp without time zone,
    partner_rationale text,
    rejected_at timestamp without time zone,
    rejected_reason text,
    paid_at timestamp without time zone,
    paid_by_user_id text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_contractor_payments OWNER TO postgres;

--
-- Name: atelier_contractors; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_contractors (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    full_name text NOT NULL,
    email text NOT NULL,
    country text,
    vendor_entity text,
    master_agreement_ref text,
    day_rate_amount double precision,
    day_rate_currency text DEFAULT 'USD'::text NOT NULL,
    start_date text,
    end_date text,
    status text DEFAULT 'active'::text NOT NULL,
    notes text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone,
    contract_type text,
    contract_start text,
    contract_end text,
    day_rate_internal_cost double precision,
    payment_terms_days integer,
    vat_treatment text,
    engagement_scope_default jsonb DEFAULT '[]'::jsonb NOT NULL,
    contracting_entity text,
    conflicts_disclosed_json jsonb DEFAULT '[]'::jsonb NOT NULL,
    country_code text,
    contract_file_id text,
    gender text DEFAULT 'unspecified'::text NOT NULL,
    nationality text,
    cell_phones jsonb DEFAULT '[]'::jsonb NOT NULL,
    office_address text,
    avatar_url text,
    personal_email text,
    home_address text,
    bio text
);


ALTER TABLE public.atelier_contractors OWNER TO postgres;

--
-- Name: atelier_corporate_cards; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_corporate_cards (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    provider text NOT NULL,
    cardholder_user_id text NOT NULL,
    last4 text NOT NULL,
    label text,
    currency text DEFAULT 'USD'::text NOT NULL,
    monthly_limit_amount double precision DEFAULT 0 NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    linked_at timestamp without time zone DEFAULT now() NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_corporate_cards OWNER TO postgres;

--
-- Name: atelier_counterparty; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_counterparty (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    kind text NOT NULL,
    legal_name text NOT NULL,
    display_name text NOT NULL,
    account_id text,
    jurisdiction text DEFAULT ''::text NOT NULL,
    bill_to_address jsonb DEFAULT 'null'::jsonb,
    vat_number text DEFAULT ''::text NOT NULL,
    payment_terms_days integer DEFAULT 30 NOT NULL,
    kyc_state text DEFAULT 'pending'::text NOT NULL,
    kyc_reviewed_at timestamp without time zone,
    notes text DEFAULT ''::text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_counterparty OWNER TO postgres;

--
-- Name: atelier_countries; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_countries (
    iso_alpha_2 text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    iso_alpha_3 text NOT NULL,
    iso_numeric text NOT NULL,
    display_name_en text NOT NULL,
    display_name_ar text,
    display_name_tr text,
    aliases jsonb DEFAULT '[]'::jsonb NOT NULL,
    region text NOT NULL,
    sub_region text,
    flag_emoji text,
    primary_currency text,
    primary_language text,
    dial_code text,
    vat_default_pct integer,
    is_gcc boolean DEFAULT false NOT NULL,
    is_cognirise_target_market boolean DEFAULT false NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    display_order_override integer,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text
);

ALTER TABLE ONLY public.atelier_countries FORCE ROW LEVEL SECURITY;


ALTER TABLE public.atelier_countries OWNER TO postgres;

--
-- Name: atelier_credentials; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_credentials (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    title text NOT NULL,
    account_id text,
    client_name text NOT NULL,
    sector text NOT NULL,
    engagement_type text NOT NULL,
    outcome_metrics jsonb DEFAULT '[]'::jsonb NOT NULL,
    anonymization_status text DEFAULT 'redacted'::text NOT NULL,
    redacted_abstract text NOT NULL,
    attributed_abstract text,
    evidence_links jsonb DEFAULT '[]'::jsonb NOT NULL,
    related_asset_id text,
    tags jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone,
    industry_code text,
    sub_industry_code text
);


ALTER TABLE public.atelier_credentials OWNER TO postgres;

--
-- Name: atelier_deal_pricings; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_deal_pricings (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    opportunity_id text NOT NULL,
    rate_card_id text NOT NULL,
    pricing_model text DEFAULT 'time_and_materials'::text NOT NULL,
    duration_weeks double precision DEFAULT 8 NOT NULL,
    team_mix jsonb DEFAULT '[]'::jsonb NOT NULL,
    computed_cost_usd double precision DEFAULT 0 NOT NULL,
    computed_price_usd double precision DEFAULT 0 NOT NULL,
    computed_margin_pct double precision DEFAULT 0 NOT NULL,
    target_margin_pct double precision DEFAULT 0.55 NOT NULL,
    margin_lock_status text DEFAULT 'green'::text NOT NULL,
    partner_override_id text,
    partner_override_at timestamp without time zone,
    partner_override_rationale text,
    countersign_partner_id text,
    countersign_at timestamp without time zone,
    countersign_rationale text,
    alternative_structures jsonb DEFAULT '[]'::jsonb NOT NULL,
    pricing_strategist_brief_id text,
    pricing_strategist_run_id text,
    pricing_strategist_output jsonb,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_deal_pricings OWNER TO postgres;

--
-- Name: atelier_deliverable_acceptance; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_deliverable_acceptance (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    engagement_id text NOT NULL,
    deliverable_id text,
    milestone_id text,
    title text NOT NULL,
    attestation_text text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    submitted_at timestamp without time zone,
    submitted_by_user_id text,
    client_signer_name text DEFAULT ''::text NOT NULL,
    client_signer_email text DEFAULT ''::text NOT NULL,
    client_signer_title text DEFAULT ''::text NOT NULL,
    signed_at timestamp without time zone,
    recorded_by_user_id text,
    evidence_url text DEFAULT ''::text NOT NULL,
    rejection_reason text DEFAULT ''::text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_deliverable_acceptance OWNER TO postgres;

--
-- Name: atelier_deliverable_publishes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_deliverable_publishes (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    deliverable_id text NOT NULL,
    deliverable_version_id text,
    engagement_id text NOT NULL,
    workspace_id text NOT NULL,
    published_by_atelier_user_id text NOT NULL,
    published_by_name text NOT NULL,
    published_at timestamp without time zone DEFAULT now() NOT NULL,
    sentinel_run_id text,
    sentinel_status text DEFAULT 'pass'::text NOT NULL,
    sentinel_checks jsonb DEFAULT '[]'::jsonb NOT NULL,
    publish_allowed boolean DEFAULT true NOT NULL,
    override_rationale text,
    overridden_by_atelier_user_id text,
    downloads_allowed boolean DEFAULT false NOT NULL,
    watermark_required boolean DEFAULT true NOT NULL,
    notes text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_deliverable_publishes OWNER TO postgres;

--
-- Name: atelier_deliverable_versions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_deliverable_versions (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    deliverable_id text NOT NULL,
    version_number integer NOT NULL,
    body text DEFAULT ''::text NOT NULL,
    format text DEFAULT 'html'::text NOT NULL,
    citations jsonb DEFAULT '[]'::jsonb NOT NULL,
    synthesis_critic_report jsonb,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone,
    notes text
);

ALTER TABLE ONLY public.atelier_deliverable_versions FORCE ROW LEVEL SECURITY;


ALTER TABLE public.atelier_deliverable_versions OWNER TO postgres;

--
-- Name: atelier_deliverables; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_deliverables (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    engagement_id text NOT NULL,
    type text NOT NULL,
    name text NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    hypothesis_id text,
    current_version_id text,
    due_date text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone,
    critic_readiness text,
    critic_report_summary text,
    partner_approved_at timestamp without time zone,
    partner_approved_by_user_id text,
    partner_approved_by_name text,
    partner_rationale text,
    lock_overridden boolean DEFAULT false NOT NULL,
    sent_at timestamp without time zone,
    sent_by_user_id text,
    client_visibility text DEFAULT 'internal'::text NOT NULL,
    latest_publish_id text
);

ALTER TABLE ONLY public.atelier_deliverables FORCE ROW LEVEL SECURITY;


ALTER TABLE public.atelier_deliverables OWNER TO postgres;

--
-- Name: atelier_dependents; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_dependents (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    person_type text NOT NULL,
    person_id text NOT NULL,
    full_name text NOT NULL,
    relationship text NOT NULL,
    date_of_birth text,
    nationality text,
    notes text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_dependents OWNER TO postgres;

--
-- Name: atelier_document_chunk_embeddings; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_document_chunk_embeddings (
    chunk_id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    attachment_id text NOT NULL,
    file_name text NOT NULL,
    kind text NOT NULL,
    account_id text,
    engagement_id text,
    uploader_user_id text,
    char_start integer NOT NULL,
    char_end integer NOT NULL,
    summary text NOT NULL,
    text text NOT NULL,
    provider text NOT NULL,
    dim integer NOT NULL,
    vec jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.atelier_document_chunk_embeddings OWNER TO postgres;

--
-- Name: atelier_dpa; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_dpa (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    engagement_id text NOT NULL,
    contract_id text,
    counterparty_id text NOT NULL,
    data_classes jsonb DEFAULT '[]'::jsonb NOT NULL,
    processor_chain jsonb DEFAULT '[]'::jsonb NOT NULL,
    status text DEFAULT 'required'::text NOT NULL,
    signed_at timestamp without time zone,
    expires_at timestamp without time zone,
    last_reviewed_at timestamp without time zone,
    notes text DEFAULT ''::text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_dpa OWNER TO postgres;

--
-- Name: atelier_dunning_event; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_dunning_event (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    invoice_id text NOT NULL,
    ladder_id text,
    step_index integer DEFAULT 0 NOT NULL,
    channel text NOT NULL,
    template text,
    message_ref text,
    sent_by text,
    sent_at timestamp without time zone DEFAULT now() NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.atelier_dunning_event OWNER TO postgres;

--
-- Name: atelier_dunning_ladder; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_dunning_ladder (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    name text NOT NULL,
    jurisdiction text NOT NULL,
    steps jsonb DEFAULT '[]'::jsonb NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_dunning_ladder OWNER TO postgres;

--
-- Name: atelier_einvoice_submission; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_einvoice_submission (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    invoice_id text NOT NULL,
    channel text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    submission_payload_ref text,
    response_payload_ref text,
    clearance_uuid text,
    qr_code_payload text,
    submitted_at timestamp without time zone,
    cleared_at timestamp without time zone,
    rejected_at timestamp without time zone,
    rejected_reason text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.atelier_einvoice_submission OWNER TO postgres;

--
-- Name: atelier_emergency_contacts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_emergency_contacts (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    person_type text NOT NULL,
    person_id text NOT NULL,
    name text NOT NULL,
    relationship text NOT NULL,
    phones jsonb DEFAULT '[]'::jsonb NOT NULL,
    email text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_emergency_contacts OWNER TO postgres;

--
-- Name: atelier_employees; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_employees (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    user_id text,
    employee_id_external text,
    full_name text NOT NULL,
    preferred_name text,
    email text NOT NULL,
    role text NOT NULL,
    seniority text DEFAULT 'consultant'::text NOT NULL,
    title text,
    home_office text,
    country text,
    payroll_country text,
    employment_type text DEFAULT 'FTE'::text NOT NULL,
    start_date text,
    end_date text,
    status text DEFAULT 'active'::text NOT NULL,
    iban text,
    swift text,
    notice_period_days integer DEFAULT 30 NOT NULL,
    partner_economics_id text,
    avatar_url text,
    notes text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone,
    employment_status text DEFAULT 'active'::text NOT NULL,
    employing_entity text,
    base_currency text,
    base_compensation double precision,
    utilization_target_pct integer,
    country_code text,
    payroll_country_code text,
    gender text DEFAULT 'unspecified'::text NOT NULL,
    nationality text,
    cell_phones jsonb DEFAULT '[]'::jsonb NOT NULL,
    office_address text,
    personal_email text,
    home_address text,
    bio text
);


ALTER TABLE public.atelier_employees OWNER TO postgres;

--
-- Name: atelier_engagement_access; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_engagement_access (
    id text NOT NULL,
    engagement_id text NOT NULL,
    user_id text NOT NULL,
    role text DEFAULT 'member'::text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    deleted_at timestamp without time zone,
    allocation_pct integer DEFAULT 0 NOT NULL,
    scope jsonb DEFAULT '[]'::jsonb NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    granted_by_user_id text,
    granted_at timestamp without time zone DEFAULT now() NOT NULL,
    end_date timestamp without time zone
);


ALTER TABLE public.atelier_engagement_access OWNER TO postgres;

--
-- Name: atelier_engagement_budget; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_engagement_budget (
    engagement_id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    contract_value_usd double precision DEFAULT 0 NOT NULL,
    budget_labour_hours double precision DEFAULT 0 NOT NULL,
    budget_labour_cost_usd double precision DEFAULT 0 NOT NULL,
    budget_expenses_usd double precision DEFAULT 0 NOT NULL,
    budget_subs_usd double precision DEFAULT 0 NOT NULL,
    budget_at_completion_usd double precision DEFAULT 0 NOT NULL,
    baselined_at text DEFAULT ''::text NOT NULL,
    partner_owner_id text DEFAULT ''::text NOT NULL,
    engagement_lead_id text DEFAULT ''::text NOT NULL,
    sector text DEFAULT ''::text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_engagement_budget OWNER TO postgres;

--
-- Name: atelier_engagement_cost_to_date; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_engagement_cost_to_date (
    engagement_id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    as_of text DEFAULT ''::text NOT NULL,
    labour_hours_to_date double precision DEFAULT 0 NOT NULL,
    labour_cost_to_date_usd double precision DEFAULT 0 NOT NULL,
    expenses_to_date_usd double precision DEFAULT 0 NOT NULL,
    subs_to_date_usd double precision DEFAULT 0 NOT NULL,
    cost_to_date_usd double precision DEFAULT 0 NOT NULL,
    revenue_recognised_to_date_usd double precision DEFAULT 0 NOT NULL,
    invoiced_to_date_usd double precision DEFAULT 0 NOT NULL,
    cash_collected_to_date_usd double precision DEFAULT 0 NOT NULL,
    pct_complete double precision DEFAULT 0 NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_engagement_cost_to_date OWNER TO postgres;

--
-- Name: atelier_engagement_etc; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_engagement_etc (
    engagement_id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    method text DEFAULT 'manual'::text NOT NULL,
    manual_etc_usd double precision,
    rationale text DEFAULT ''::text NOT NULL,
    updated_at_iso text DEFAULT ''::text NOT NULL,
    updated_by_user_id text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_engagement_etc OWNER TO postgres;

--
-- Name: atelier_engagement_margin_snapshot; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_engagement_margin_snapshot (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    snapshot_at timestamp without time zone DEFAULT now() NOT NULL,
    engagement_id text NOT NULL,
    period_label text NOT NULL,
    revenue_recognised double precision DEFAULT 0 NOT NULL,
    direct_cost double precision DEFAULT 0 NOT NULL,
    gross_margin_amount double precision DEFAULT 0 NOT NULL,
    gross_margin_pct double precision DEFAULT 0 NOT NULL,
    realization_rate double precision DEFAULT 0 NOT NULL,
    hours_billable double precision DEFAULT 0 NOT NULL,
    hours_billed double precision DEFAULT 0 NOT NULL,
    standard_revenue_at_rack double precision DEFAULT 0 NOT NULL,
    leakage_amount double precision DEFAULT 0 NOT NULL,
    currency text DEFAULT 'USD'::text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_engagement_margin_snapshot OWNER TO postgres;

--
-- Name: atelier_engagement_pnl_audit; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_engagement_pnl_audit (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    engagement_id text NOT NULL,
    at_iso text DEFAULT ''::text NOT NULL,
    actor_user_id text,
    action text NOT NULL,
    detail text DEFAULT ''::text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.atelier_engagement_pnl_audit OWNER TO postgres;

--
-- Name: atelier_engagement_pnl_change_order; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_engagement_pnl_change_order (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    engagement_id text NOT NULL,
    number text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    value_usd double precision DEFAULT 0 NOT NULL,
    hours_impact double precision DEFAULT 0 NOT NULL,
    cost_impact_usd double precision DEFAULT 0 NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    submitted_at_iso text,
    approved_at_iso text,
    rejected_at_iso text,
    raised_by_user_id text DEFAULT ''::text NOT NULL,
    approved_by_user_id text,
    rejection_reason text,
    created_at_iso text DEFAULT ''::text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_engagement_pnl_change_order OWNER TO postgres;

--
-- Name: atelier_engagements; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_engagements (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    opportunity_id text,
    account_id text NOT NULL,
    plm_stage text NOT NULL,
    partner_owner_id text NOT NULL,
    engagement_lead_id text NOT NULL,
    charter jsonb,
    workstreams jsonb DEFAULT '[]'::jsonb NOT NULL,
    value_case jsonb,
    start_date text NOT NULL,
    planned_end_date text NOT NULL,
    raid_status text DEFAULT 'green'::text NOT NULL,
    deliverables_due_this_week integer DEFAULT 0 NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone,
    default_language text DEFAULT 'en'::text NOT NULL
);

ALTER TABLE ONLY public.atelier_engagements FORCE ROW LEVEL SECURITY;


ALTER TABLE public.atelier_engagements OWNER TO postgres;

--
-- Name: atelier_entity_embeddings; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_entity_embeddings (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    kind text NOT NULL,
    target_id text NOT NULL,
    label text NOT NULL,
    summary_text text NOT NULL,
    provider text NOT NULL,
    dim integer NOT NULL,
    vec jsonb NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.atelier_entity_embeddings OWNER TO postgres;

--
-- Name: atelier_expense_policies; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_expense_policies (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    category text NOT NULL,
    applies_to_role text,
    applies_to_country text,
    cap_amount_usd double precision,
    cap_unit text,
    hard_block_amount_usd double precision,
    approval_threshold_usd double precision,
    flight_class_max text,
    rationale text,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_expense_policies OWNER TO postgres;

--
-- Name: atelier_expenses; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_expenses (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    person_id text NOT NULL,
    person_type text DEFAULT 'employee'::text NOT NULL,
    engagement_id text,
    expense_date text NOT NULL,
    capture_source text NOT NULL,
    card_id text,
    merchant text,
    description text,
    category text DEFAULT 'other'::text NOT NULL,
    amount double precision DEFAULT 0 NOT NULL,
    currency text DEFAULT 'USD'::text NOT NULL,
    fx_rate double precision DEFAULT 1 NOT NULL,
    fx_rate_date text,
    usd_amount double precision DEFAULT 0 NOT NULL,
    vat_amount double precision DEFAULT 0 NOT NULL,
    vat_currency text,
    vat_treatment text DEFAULT 'none'::text NOT NULL,
    vat_country text,
    client_billable boolean DEFAULT false NOT NULL,
    markup_pct double precision DEFAULT 0 NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    policy_status text DEFAULT 'green'::text NOT NULL,
    policy_findings jsonb DEFAULT '[]'::jsonb NOT NULL,
    override_rationale text,
    auditor_run_id text,
    auditor_proposal jsonb DEFAULT 'null'::jsonb,
    receipt_file_ref text,
    receipt_fixture_key text,
    receipt_encrypted_at_rest boolean DEFAULT true NOT NULL,
    ocr_payload jsonb DEFAULT 'null'::jsonb,
    ocr_payload_redacted_at timestamp without time zone,
    summary text,
    submitted_at timestamp without time zone,
    approved_at timestamp without time zone,
    approved_by_user_id text,
    rejected_at timestamp without time zone,
    rejected_reason text,
    created_by_user_id text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    deleted_at timestamp without time zone,
    vat_country_code text,
    context_type text DEFAULT 'bd'::text NOT NULL,
    account_id text,
    internal_project_label text,
    reimbursed_at timestamp without time zone,
    reimbursed_by_user_id text
);

ALTER TABLE ONLY public.atelier_expenses FORCE ROW LEVEL SECURITY;


ALTER TABLE public.atelier_expenses OWNER TO postgres;

--
-- Name: atelier_extracted_documents; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_extracted_documents (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    attachment_id text NOT NULL,
    kind text NOT NULL,
    normalized_text text DEFAULT ''::text NOT NULL,
    table_summary jsonb,
    slide_texts jsonb,
    email_headers jsonb,
    chunks jsonb DEFAULT '[]'::jsonb NOT NULL,
    digest jsonb,
    warnings jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.atelier_extracted_documents OWNER TO postgres;

--
-- Name: atelier_finance_plan_commits; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_finance_plan_commits (
    id text NOT NULL,
    scenario_id text NOT NULL,
    scenario_label text NOT NULL,
    period_label text DEFAULT ''::text NOT NULL,
    note text DEFAULT ''::text NOT NULL,
    by_user_id text NOT NULL,
    by_user_name text NOT NULL,
    by_role text NOT NULL,
    committed_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.atelier_finance_plan_commits OWNER TO postgres;

--
-- Name: atelier_firm_profile; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_firm_profile (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    version integer NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    run_id text,
    notes text,
    published_at timestamp without time zone,
    published_by_user_id text,
    published_by_name text,
    superseded_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_firm_profile OWNER TO postgres;

--
-- Name: atelier_fx_rates; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_fx_rates (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    date text NOT NULL,
    base text DEFAULT 'USD'::text NOT NULL,
    quote text NOT NULL,
    rate double precision NOT NULL,
    source text DEFAULT 'seed'::text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.atelier_fx_rates OWNER TO postgres;

--
-- Name: atelier_guardhouse_backups; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_guardhouse_backups (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    store text NOT NULL,
    kind text NOT NULL,
    last_success_at text NOT NULL,
    status text NOT NULL,
    rto_minutes integer DEFAULT 0 NOT NULL,
    rpo_minutes integer DEFAULT 0 NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_guardhouse_backups OWNER TO postgres;

--
-- Name: atelier_guardhouse_controls; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_guardhouse_controls (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    title text NOT NULL,
    framework text NOT NULL,
    owner text NOT NULL,
    status text NOT NULL,
    last_collected_at text DEFAULT ''::text NOT NULL,
    remediation text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_guardhouse_controls OWNER TO postgres;

--
-- Name: atelier_guardhouse_dsars; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_guardhouse_dsars (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    subject_masked text NOT NULL,
    jurisdiction text NOT NULL,
    request_kind text NOT NULL,
    intake_at text NOT NULL,
    statutory_due_at text NOT NULL,
    days_to_deadline integer DEFAULT 0 NOT NULL,
    phase text NOT NULL,
    discovered_artifacts integer DEFAULT 0 NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_guardhouse_dsars OWNER TO postgres;

--
-- Name: atelier_guardhouse_evidence; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_guardhouse_evidence (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    title text NOT NULL,
    kind text NOT NULL,
    control_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    collected_at text NOT NULL,
    freshness text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_guardhouse_evidence OWNER TO postgres;

--
-- Name: atelier_guardhouse_incidents; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_guardhouse_incidents (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    title text NOT NULL,
    severity text NOT NULL,
    detected_at text NOT NULL,
    phase text NOT NULL,
    summary text DEFAULT ''::text NOT NULL,
    postmortem_url text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_guardhouse_incidents OWNER TO postgres;

--
-- Name: atelier_guardhouse_pentests; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_guardhouse_pentests (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    engagement text NOT NULL,
    vendor text NOT NULL,
    window_start text NOT NULL,
    window_end text NOT NULL,
    findings_high integer DEFAULT 0 NOT NULL,
    findings_med integer DEFAULT 0 NOT NULL,
    findings_low integer DEFAULT 0 NOT NULL,
    remediated integer DEFAULT 0 NOT NULL,
    status text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_guardhouse_pentests OWNER TO postgres;

--
-- Name: atelier_guardhouse_vendors; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_guardhouse_vendors (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    vendor text NOT NULL,
    direction text NOT NULL,
    data_class text NOT NULL,
    owner text NOT NULL,
    risk text NOT NULL,
    renews_at text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_guardhouse_vendors OWNER TO postgres;

--
-- Name: atelier_hypothesis_trees; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_hypothesis_trees (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    engagement_id text NOT NULL,
    root jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);

ALTER TABLE ONLY public.atelier_hypothesis_trees FORCE ROW LEVEL SECURITY;


ALTER TABLE public.atelier_hypothesis_trees OWNER TO postgres;

--
-- Name: atelier_industries; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_industries (
    code text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    display_name_en text NOT NULL,
    display_name_ar text,
    short_description text,
    display_order integer NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text
);

ALTER TABLE ONLY public.atelier_industries FORCE ROW LEVEL SECURITY;


ALTER TABLE public.atelier_industries OWNER TO postgres;

--
-- Name: atelier_insurance_certificate; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_insurance_certificate (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    counterparty_id text NOT NULL,
    kind text NOT NULL,
    insurer_name text NOT NULL,
    policy_number text NOT NULL,
    coverage_limit_usd double precision DEFAULT 0 NOT NULL,
    coverage_start text NOT NULL,
    coverage_end text NOT NULL,
    certificate_url text DEFAULT ''::text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_insurance_certificate OWNER TO postgres;

--
-- Name: atelier_invitations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_invitations (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    worker_type text NOT NULL,
    person_draft jsonb NOT NULL,
    sent_by_user_id text NOT NULL,
    sent_at timestamp without time zone DEFAULT now() NOT NULL,
    expires_at timestamp without time zone,
    accepted_at timestamp without time zone,
    accepted_person_id text,
    revoked_at timestamp without time zone,
    revoked_by_user_id text,
    status text DEFAULT 'sent'::text NOT NULL,
    notes text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_invitations OWNER TO postgres;

--
-- Name: atelier_invoice; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_invoice (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    engagement_id text,
    account_id text,
    jurisdiction text NOT NULL,
    invoice_number text,
    currency text DEFAULT 'USD'::text NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    bill_to jsonb DEFAULT '{}'::jsonb NOT NULL,
    subtotal double precision DEFAULT 0 NOT NULL,
    vat_amount double precision DEFAULT 0 NOT NULL,
    vat_rate_pct double precision DEFAULT 0 NOT NULL,
    total double precision DEFAULT 0 NOT NULL,
    amount_paid double precision DEFAULT 0 NOT NULL,
    notes text,
    due_date text,
    issued_at timestamp without time zone,
    paid_at timestamp without time zone,
    voided_at timestamp without time zone,
    voided_reason text,
    pdf_ref text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_invoice OWNER TO postgres;

--
-- Name: atelier_invoice_line; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_invoice_line (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    invoice_id text NOT NULL,
    ord integer DEFAULT 0 NOT NULL,
    description text NOT NULL,
    qty double precision DEFAULT 1 NOT NULL,
    unit_price double precision DEFAULT 0 NOT NULL,
    amount double precision DEFAULT 0 NOT NULL,
    source_kind text NOT NULL,
    source_ref text,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.atelier_invoice_line OWNER TO postgres;

--
-- Name: atelier_invoice_line_drafts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_invoice_line_drafts (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    engagement_id text NOT NULL,
    composed_at timestamp without time zone DEFAULT now() NOT NULL,
    composed_by_user_id text,
    composer_run_id text,
    rate_card_id text,
    lines jsonb DEFAULT '[]'::jsonb NOT NULL,
    totals jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    exported_at timestamp without time zone,
    notes text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_invoice_line_drafts OWNER TO postgres;

--
-- Name: atelier_invoice_sequence; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_invoice_sequence (
    jurisdiction text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    year_part integer NOT NULL,
    prefix text NOT NULL,
    last_seq integer DEFAULT 0 NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.atelier_invoice_sequence OWNER TO postgres;

--
-- Name: atelier_ip_code_assets; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_ip_code_assets (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    name text NOT NULL,
    repo_url text NOT NULL,
    owner text NOT NULL,
    license text NOT NULL,
    summary text DEFAULT ''::text NOT NULL,
    used_in_engagements jsonb DEFAULT '[]'::jsonb NOT NULL,
    freshness text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_ip_code_assets OWNER TO postgres;

--
-- Name: atelier_ip_demo_environments; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_ip_demo_environments (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    name text NOT NULL,
    url text NOT NULL,
    owner text NOT NULL,
    last_deploy_at text NOT NULL,
    shows text DEFAULT ''::text NOT NULL,
    uptime_30d double precision DEFAULT 0 NOT NULL,
    script_drift integer DEFAULT 0 NOT NULL,
    freshness text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_ip_demo_environments OWNER TO postgres;

--
-- Name: atelier_ip_license_grants; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_ip_license_grants (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    asset_name text NOT NULL,
    grantee text NOT NULL,
    engagement_id text DEFAULT '—'::text NOT NULL,
    granted_at text NOT NULL,
    expires_at text NOT NULL,
    scope text DEFAULT ''::text NOT NULL,
    approved_by text NOT NULL,
    status text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_ip_license_grants OWNER TO postgres;

--
-- Name: atelier_ip_oss_dependencies; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_ip_oss_dependencies (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    name text NOT NULL,
    version text NOT NULL,
    ecosystem text NOT NULL,
    license text NOT NULL,
    compatibility text NOT NULL,
    repos jsonb DEFAULT '[]'::jsonb NOT NULL,
    rationale text,
    exception_until text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_ip_oss_dependencies OWNER TO postgres;

--
-- Name: atelier_leave_entitlements; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_leave_entitlements (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    person_id text NOT NULL,
    person_type text NOT NULL,
    year integer NOT NULL,
    annual_days double precision DEFAULT 25 NOT NULL,
    sick_days double precision DEFAULT 10 NOT NULL,
    notes text,
    updated_by_user_id text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.atelier_leave_entitlements OWNER TO postgres;

--
-- Name: atelier_leave_requests; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_leave_requests (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    user_id text NOT NULL,
    person_id text NOT NULL,
    person_type text NOT NULL,
    leave_type text NOT NULL,
    start_date text NOT NULL,
    end_date text NOT NULL,
    working_days double precision DEFAULT 0 NOT NULL,
    note text,
    status text DEFAULT 'pending'::text NOT NULL,
    decided_at timestamp without time zone,
    decided_by_user_id text,
    decision_reason text,
    cancelled_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_leave_requests OWNER TO postgres;

--
-- Name: atelier_leave_type_entitlements; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_leave_type_entitlements (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    employment_type text NOT NULL,
    year integer NOT NULL,
    annual_days double precision DEFAULT 25 NOT NULL,
    sick_days double precision DEFAULT 10 NOT NULL,
    updated_by_user_id text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.atelier_leave_type_entitlements OWNER TO postgres;

--
-- Name: atelier_margin_policies; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_margin_policies (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    name text DEFAULT 'default'::text NOT NULL,
    target_margin_pct double precision DEFAULT 0.55 NOT NULL,
    amber_threshold_pct double precision DEFAULT 0.5 NOT NULL,
    red_threshold_pct double precision DEFAULT 0.45 NOT NULL,
    two_partner_threshold_pct double precision DEFAULT 0.45 NOT NULL,
    is_default boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_margin_policies OWNER TO postgres;

--
-- Name: atelier_meetings; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_meetings (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    parent_type text NOT NULL,
    parent_id text NOT NULL,
    mode text DEFAULT 'upload'::text NOT NULL,
    kind text DEFAULT 'discovery'::text NOT NULL,
    title text NOT NULL,
    date text NOT NULL,
    attendees jsonb DEFAULT '[]'::jsonb NOT NULL,
    transcript_id text,
    summary text,
    decisions jsonb DEFAULT '[]'::jsonb NOT NULL,
    action_items jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone,
    run_id text,
    status text DEFAULT 'draft'::text NOT NULL,
    committed_at timestamp without time zone,
    committed_by_user_id text
);

ALTER TABLE ONLY public.atelier_meetings FORCE ROW LEVEL SECURITY;


ALTER TABLE public.atelier_meetings OWNER TO postgres;

--
-- Name: atelier_notifications; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_notifications (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    user_id text NOT NULL,
    kind text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    read_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone,
    channel text DEFAULT 'in_app'::text,
    subject text,
    body text,
    ref_type text,
    ref_id text,
    scheduled_for timestamp without time zone,
    sent_at timestamp without time zone,
    status text DEFAULT 'queued'::text
);

ALTER TABLE ONLY public.atelier_notifications FORCE ROW LEVEL SECURITY;


ALTER TABLE public.atelier_notifications OWNER TO postgres;

--
-- Name: atelier_offboarding_steps; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_offboarding_steps (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    offboarding_id text NOT NULL,
    sort_key integer DEFAULT 0 NOT NULL,
    code text NOT NULL,
    title text NOT NULL,
    description text,
    owner_role text,
    deadline text,
    status text DEFAULT 'pending'::text NOT NULL,
    completed_at timestamp without time zone,
    completed_by_user_id text,
    blocked_reason text,
    is_reassignment_gate boolean DEFAULT false NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_offboarding_steps OWNER TO postgres;

--
-- Name: atelier_offboardings; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_offboardings (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    person_type text NOT NULL,
    person_id text NOT NULL,
    initiated_at timestamp without time zone DEFAULT now() NOT NULL,
    initiated_by_user_id text,
    last_working_date text,
    completed_at timestamp without time zone,
    blocked_at timestamp without time zone,
    blocked_reason text,
    status text DEFAULT 'in_flight'::text NOT NULL,
    audit_pack_url text,
    audit_pack_signed_by_user_id text,
    audit_pack_signed_at timestamp without time zone,
    reason text,
    notes text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_offboardings OWNER TO postgres;

--
-- Name: atelier_onboarding_steps; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_onboarding_steps (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    onboarding_id text NOT NULL,
    sort_key integer DEFAULT 0 NOT NULL,
    code text NOT NULL,
    title text NOT NULL,
    description text,
    owner_role text,
    deadline text,
    status text DEFAULT 'pending'::text NOT NULL,
    completed_at timestamp without time zone,
    completed_by_user_id text,
    blocked_reason text,
    is_compliance_gate boolean DEFAULT false NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_onboarding_steps OWNER TO postgres;

--
-- Name: atelier_onboardings; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_onboardings (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    person_type text NOT NULL,
    person_id text NOT NULL,
    invitation_id text,
    started_at timestamp without time zone DEFAULT now() NOT NULL,
    target_start_date text,
    completed_at timestamp without time zone,
    blocked_at timestamp without time zone,
    blocked_reason text,
    status text DEFAULT 'in_flight'::text NOT NULL,
    owner_user_id text,
    notes text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_onboardings OWNER TO postgres;

--
-- Name: atelier_opportunities; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_opportunities (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    account_id text NOT NULL,
    buyer_persona text,
    offering_anchor text,
    partner_owner_id text NOT NULL,
    engagement_lead_id text NOT NULL,
    deal_size_hypothesis double precision NOT NULL,
    probability_pct double precision NOT NULL,
    qualify_5c jsonb,
    go_no_go_decision jsonb,
    next_milestone text NOT NULL,
    next_milestone_date text,
    source_lead text NOT NULL,
    days_in_stage integer DEFAULT 0 NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone,
    sales_stage text DEFAULT 'suspect'::text NOT NULL,
    sub_status text,
    runner_entered_at timestamp with time zone,
    contract_signed_at timestamp with time zone,
    qualification_rubric jsonb,
    close_date text,
    forecast_category text DEFAULT 'pipeline'::text NOT NULL
);

ALTER TABLE ONLY public.atelier_opportunities FORCE ROW LEVEL SECURITY;


ALTER TABLE public.atelier_opportunities OWNER TO postgres;

--
-- Name: atelier_opportunity_stage_transitions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_opportunity_stage_transitions (
    id text NOT NULL,
    opportunity_id text NOT NULL,
    from_stage text,
    to_stage text NOT NULL,
    transitioned_by_user_id text NOT NULL,
    rationale_text text,
    evidence_artifact_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    prior_probability_pct double precision,
    new_probability_pct double precision,
    next_milestone text,
    next_milestone_date text,
    agent_recommended boolean DEFAULT false NOT NULL,
    partner_override boolean DEFAULT false NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    legacy_stage_label text,
    decider text,
    verbal_commit_date text,
    signature_path text,
    signed_instrument_file_id text,
    reason_code text
);


ALTER TABLE public.atelier_opportunity_stage_transitions OWNER TO postgres;

--
-- Name: atelier_pane_a_items; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_pane_a_items (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    user_id text NOT NULL,
    title text NOT NULL,
    summary text NOT NULL,
    priority text NOT NULL,
    href_kind text NOT NULL,
    href_target_id text NOT NULL,
    due_label text NOT NULL,
    sort_key integer DEFAULT 0 NOT NULL,
    resolved_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);

ALTER TABLE ONLY public.atelier_pane_a_items FORCE ROW LEVEL SECURITY;


ALTER TABLE public.atelier_pane_a_items OWNER TO postgres;

--
-- Name: atelier_partner_economics; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_partner_economics (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    employee_id text NOT NULL,
    profit_share_bps integer DEFAULT 0 NOT NULL,
    vesting_schedule jsonb DEFAULT '[]'::jsonb NOT NULL,
    notes text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone,
    model text,
    revenue_share_pct double precision,
    base_amount double precision,
    currency text,
    effective_from text,
    effective_to text
);


ALTER TABLE public.atelier_partner_economics OWNER TO postgres;

--
-- Name: atelier_partner_firm_hours; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_partner_firm_hours (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    engagement_id text NOT NULL,
    partner_firm_id text NOT NULL,
    partner_firm_resource_id text,
    resource_name text NOT NULL,
    week_iso text NOT NULL,
    work_date text,
    hours double precision DEFAULT 0 NOT NULL,
    cost_amount double precision DEFAULT 0 NOT NULL,
    cost_currency text DEFAULT 'USD'::text NOT NULL,
    csv_upload_ref text,
    uploaded_at timestamp without time zone DEFAULT now() NOT NULL,
    uploaded_by_user_id text,
    notes text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_partner_firm_hours OWNER TO postgres;

--
-- Name: atelier_partner_firm_invoices; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_partner_firm_invoices (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    partner_firm_id text NOT NULL,
    partner_firm_name text NOT NULL,
    engagement_id text NOT NULL,
    week_iso text NOT NULL,
    hours double precision DEFAULT 0 NOT NULL,
    cost_amount double precision DEFAULT 0 NOT NULL,
    cost_currency text DEFAULT 'USD'::text NOT NULL,
    fx_rate double precision DEFAULT 1 NOT NULL,
    usd_amount double precision DEFAULT 0 NOT NULL,
    status text DEFAULT 'proposed'::text NOT NULL,
    proposal_run_id text,
    evidence_firm_hour_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    notes text,
    partner_approved_by_user_id text,
    partner_approved_at timestamp without time zone,
    partner_rationale text,
    rejected_at timestamp without time zone,
    rejected_reason text,
    paid_at timestamp without time zone,
    paid_by_user_id text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_partner_firm_invoices OWNER TO postgres;

--
-- Name: atelier_partner_firm_resources; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_partner_firm_resources (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    partner_firm_id text NOT NULL,
    full_name text NOT NULL,
    email text,
    role text,
    seniority text,
    country text,
    day_rate_amount double precision,
    day_rate_currency text DEFAULT 'USD'::text NOT NULL,
    start_date text,
    end_date text,
    status text DEFAULT 'active'::text NOT NULL,
    notes text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone,
    role_on_engagement text,
    seniority_band text,
    seconded_to_engagement_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    cost_to_cognirise_per_day double precision,
    visible_to_client_in_team_tab boolean DEFAULT false NOT NULL,
    partner_firm_pm_user_id text,
    country_code text,
    gender text DEFAULT 'unspecified'::text NOT NULL,
    nationality text
);


ALTER TABLE public.atelier_partner_firm_resources OWNER TO postgres;

--
-- Name: atelier_partner_firms; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_partner_firms (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    name text NOT NULL,
    country text,
    master_agreement_ref text,
    master_agreement_url text,
    contact_name text,
    contact_email text,
    status text DEFAULT 'active'::text NOT NULL,
    notes text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone,
    hq_country text,
    master_agreement_status text DEFAULT 'active'::text NOT NULL,
    master_agreement_end text,
    primary_contact_user_id text,
    default_payment_terms_days integer,
    rate_card_id text,
    default_billing_currency text,
    insurance_status text,
    country_code text,
    hq_country_code text
);


ALTER TABLE public.atelier_partner_firms OWNER TO postgres;

--
-- Name: atelier_pay_documents; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_pay_documents (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    person_type text NOT NULL,
    person_id text NOT NULL,
    category text NOT NULL,
    title text NOT NULL,
    period_date text,
    published boolean DEFAULT false NOT NULL,
    published_at timestamp without time zone,
    published_by_user_id text,
    retracted_at timestamp without time zone,
    file_name text NOT NULL,
    mime text DEFAULT 'application/octet-stream'::text NOT NULL,
    size_bytes integer DEFAULT 0 NOT NULL,
    file_data text NOT NULL,
    uploaded_by_user_id text,
    notes text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_pay_documents OWNER TO postgres;

--
-- Name: atelier_performance_goals; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_performance_goals (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    employee_id text NOT NULL,
    cycle text NOT NULL,
    title text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    weight_pct integer DEFAULT 0 NOT NULL,
    status text DEFAULT 'on_track'::text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_performance_goals OWNER TO postgres;

--
-- Name: atelier_performance_reviews; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_performance_reviews (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    employee_id text NOT NULL,
    cycle text NOT NULL,
    reviewed_on text,
    self_rating text,
    manager_rating text,
    strengths text DEFAULT ''::text NOT NULL,
    growth_areas text DEFAULT ''::text NOT NULL,
    manager_summary text DEFAULT ''::text NOT NULL,
    hr_notes text DEFAULT ''::text NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    released_at timestamp without time zone,
    released_by_user_id text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_performance_reviews OWNER TO postgres;

--
-- Name: atelier_period_close_lock; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_period_close_lock (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    period_label text NOT NULL,
    locked_modules jsonb DEFAULT '[]'::jsonb NOT NULL,
    locked_at timestamp without time zone DEFAULT now() NOT NULL,
    locked_by_user_id text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_period_close_lock OWNER TO postgres;

--
-- Name: atelier_person_documents; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_person_documents (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    person_type text NOT NULL,
    person_id text NOT NULL,
    kind text NOT NULL,
    title text NOT NULL,
    file_url text,
    uploaded_by_user_id text,
    uploaded_at timestamp without time zone DEFAULT now() NOT NULL,
    expires_at timestamp without time zone,
    notes text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone,
    client_account_id text,
    file_ref text,
    signed_at timestamp without time zone,
    doc_number text,
    issued_at text,
    issuing_country text,
    dependent_id text,
    file_name text,
    mime text,
    size_bytes integer
);


ALTER TABLE public.atelier_person_documents OWNER TO postgres;

--
-- Name: atelier_person_insurance; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_person_insurance (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    person_type text NOT NULL,
    person_id text NOT NULL,
    provider text DEFAULT ''::text NOT NULL,
    policy_number text DEFAULT ''::text NOT NULL,
    member_number text DEFAULT ''::text NOT NULL,
    coverage_summary text DEFAULT ''::text NOT NULL,
    notes text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_person_insurance OWNER TO postgres;

--
-- Name: atelier_person_skills; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_person_skills (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    person_type text NOT NULL,
    person_id text NOT NULL,
    skill_id text NOT NULL,
    proficiency integer DEFAULT 3 NOT NULL,
    source text NOT NULL,
    evidence_artifact_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    evidence_summary text,
    confidence double precision,
    status text DEFAULT 'active'::text NOT NULL,
    verified_by_user_id text,
    verified_at timestamp without time zone,
    proposed_by_agent_id text,
    proposed_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_person_skills OWNER TO postgres;

--
-- Name: atelier_pov_versions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_pov_versions (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    pov_id text NOT NULL,
    version_number integer NOT NULL,
    body text DEFAULT ''::text NOT NULL,
    sections jsonb DEFAULT '[]'::jsonb NOT NULL,
    citations jsonb DEFAULT '[]'::jsonb NOT NULL,
    citation_coverage double precision,
    notes text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_pov_versions OWNER TO postgres;

--
-- Name: atelier_povs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_povs (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    opportunity_id text NOT NULL,
    title text NOT NULL,
    audience text,
    objective text,
    status text DEFAULT 'outline'::text NOT NULL,
    outline jsonb DEFAULT '[]'::jsonb NOT NULL,
    current_version_id text,
    run_id text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_povs OWNER TO postgres;

--
-- Name: atelier_press_editorial_calendar; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_press_editorial_calendar (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    working_title text NOT NULL,
    publication text NOT NULL,
    byline text NOT NULL,
    publish_on text NOT NULL,
    status text NOT NULL,
    thesis text DEFAULT ''::text NOT NULL,
    theme_id text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_press_editorial_calendar OWNER TO postgres;

--
-- Name: atelier_press_in_flight_content; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_press_in_flight_content (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    title text NOT NULL,
    kind text NOT NULL,
    byline text NOT NULL,
    word_count integer DEFAULT 0 NOT NULL,
    source_artifact text DEFAULT ''::text NOT NULL,
    phase text NOT NULL,
    citation_coverage double precision DEFAULT 0 NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_press_in_flight_content OWNER TO postgres;

--
-- Name: atelier_press_mentions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_press_mentions (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    headline text NOT NULL,
    publication text NOT NULL,
    date text NOT NULL,
    about text DEFAULT ''::text NOT NULL,
    summary text DEFAULT ''::text NOT NULL,
    sentiment text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_press_mentions OWNER TO postgres;

--
-- Name: atelier_press_newsletter; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_press_newsletter (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    total_subscribers integer DEFAULT 0 NOT NULL,
    net_growth_last_90d integer DEFAULT 0 NOT NULL,
    avg_open_rate double precision DEFAULT 0 NOT NULL,
    avg_click_rate double precision DEFAULT 0 NOT NULL,
    current_issue jsonb DEFAULT 'null'::jsonb,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_press_newsletter OWNER TO postgres;

--
-- Name: atelier_press_partner_cadence; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_press_partner_cadence (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    partner_id text NOT NULL,
    partner_name text NOT NULL,
    voice_profile text NOT NULL,
    target_per_90d integer DEFAULT 0 NOT NULL,
    posts_this_90d integer DEFAULT 0 NOT NULL,
    cadence_met boolean DEFAULT false NOT NULL,
    queue jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_press_partner_cadence OWNER TO postgres;

--
-- Name: atelier_press_speaking_opportunities; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_press_speaking_opportunities (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    event text NOT NULL,
    kind text NOT NULL,
    location text NOT NULL,
    date text NOT NULL,
    audience text DEFAULT ''::text NOT NULL,
    ask text DEFAULT ''::text NOT NULL,
    decision text NOT NULL,
    owner text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_press_speaking_opportunities OWNER TO postgres;

--
-- Name: atelier_principle_override; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_principle_override (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    actor_user_id text NOT NULL,
    actor_role text NOT NULL,
    target_table text NOT NULL,
    target_id text,
    sensitivity_class text NOT NULL,
    reason text NOT NULL,
    granted_at timestamp without time zone DEFAULT now() NOT NULL,
    expires_at timestamp without time zone
);

ALTER TABLE ONLY public.atelier_principle_override FORCE ROW LEVEL SECURITY;


ALTER TABLE public.atelier_principle_override OWNER TO postgres;

--
-- Name: atelier_processes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_processes (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    engagement_id text NOT NULL,
    name text NOT NULL,
    diagram text,
    steps jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);

ALTER TABLE ONLY public.atelier_processes FORCE ROW LEVEL SECURITY;


ALTER TABLE public.atelier_processes OWNER TO postgres;

--
-- Name: atelier_promise_to_pay; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_promise_to_pay (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    invoice_id text NOT NULL,
    promised_amount double precision NOT NULL,
    promised_date text NOT NULL,
    contact_name text,
    status text DEFAULT 'open'::text NOT NULL,
    recorded_by text,
    notes text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.atelier_promise_to_pay OWNER TO postgres;

--
-- Name: atelier_prompts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_prompts (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    agent_id text NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    body text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    eval_score double precision,
    author text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);

ALTER TABLE ONLY public.atelier_prompts FORCE ROW LEVEL SECURITY;


ALTER TABLE public.atelier_prompts OWNER TO postgres;

--
-- Name: atelier_proposal_recipients; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_proposal_recipients (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    proposal_id text NOT NULL,
    recipient_name text NOT NULL,
    recipient_email text,
    recipient_org text,
    token text NOT NULL,
    expires_at timestamp without time zone,
    revoked_at timestamp without time zone,
    open_count integer DEFAULT 0 NOT NULL,
    last_opened_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text
);


ALTER TABLE public.atelier_proposal_recipients OWNER TO postgres;

--
-- Name: atelier_proposal_sections; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_proposal_sections (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    proposal_id text NOT NULL,
    section_id text NOT NULL,
    name text NOT NULL,
    owner_agent text NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    content text DEFAULT ''::text NOT NULL,
    citations jsonb DEFAULT '[]'::jsonb NOT NULL,
    notes text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);

ALTER TABLE ONLY public.atelier_proposal_sections FORCE ROW LEVEL SECURITY;


ALTER TABLE public.atelier_proposal_sections OWNER TO postgres;

--
-- Name: atelier_proposals; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_proposals (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    opportunity_id text NOT NULL,
    run_id text,
    title text NOT NULL,
    sections_required jsonb DEFAULT '[]'::jsonb NOT NULL,
    team_proposed jsonb DEFAULT '[]'::jsonb NOT NULL,
    pricing_intent jsonb DEFAULT '{}'::jsonb NOT NULL,
    pricing_model jsonb DEFAULT '{}'::jsonb NOT NULL,
    win_themes jsonb DEFAULT '[]'::jsonb NOT NULL,
    compliance_matrix jsonb DEFAULT '[]'::jsonb NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    docx_url text,
    pdf_url text,
    deadline timestamp without time zone,
    partner_approved_at timestamp without time zone,
    partner_approved_by_user_id text,
    sent_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);

ALTER TABLE ONLY public.atelier_proposals FORCE ROW LEVEL SECURITY;


ALTER TABLE public.atelier_proposals OWNER TO postgres;

--
-- Name: atelier_prototypes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_prototypes (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    opportunity_id text,
    engagement_id text,
    run_id text,
    name text NOT NULL,
    brief jsonb DEFAULT '{}'::jsonb NOT NULL,
    replit_prompt_md text DEFAULT ''::text NOT NULL,
    build_plan jsonb DEFAULT '[]'::jsonb NOT NULL,
    demo_storyboard jsonb DEFAULT '[]'::jsonb NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    lead_approved_at timestamp without time zone,
    lead_approved_by_user_id text,
    partner_approved_at timestamp without time zone,
    partner_approved_by_user_id text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);

ALTER TABLE ONLY public.atelier_prototypes FORCE ROW LEVEL SECURITY;


ALTER TABLE public.atelier_prototypes OWNER TO postgres;

--
-- Name: atelier_raid_items; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_raid_items (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    engagement_id text NOT NULL,
    kind text NOT NULL,
    severity text NOT NULL,
    owner_id text,
    status text DEFAULT 'open'::text NOT NULL,
    due_date text,
    description text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone,
    mitigation text
);

ALTER TABLE ONLY public.atelier_raid_items FORCE ROW LEVEL SECURITY;


ALTER TABLE public.atelier_raid_items OWNER TO postgres;

--
-- Name: atelier_rate_card_rows; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_rate_card_rows (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    rate_card_id text NOT NULL,
    role text NOT NULL,
    seniority text NOT NULL,
    day_rate_internal_cost double precision NOT NULL,
    day_rate_client_price double precision NOT NULL,
    overhead_pct double precision DEFAULT 0.25 NOT NULL,
    currency text DEFAULT 'USD'::text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_rate_card_rows OWNER TO postgres;

--
-- Name: atelier_rate_cards; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_rate_cards (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    name text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    geography text NOT NULL,
    currency text NOT NULL,
    effective_from timestamp without time zone DEFAULT now() NOT NULL,
    effective_to timestamp without time zone,
    source_url text,
    notes text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_rate_cards OWNER TO postgres;

--
-- Name: atelier_renewal; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_renewal (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    engagement_id text,
    contract_id text,
    account_id text,
    current_arr_usd double precision DEFAULT 0 NOT NULL,
    proposed_arr_usd double precision DEFAULT 0 NOT NULL,
    expansion_target_usd double precision DEFAULT 0 NOT NULL,
    nrr_delta_pct double precision DEFAULT 0 NOT NULL,
    renewal_due_at text,
    risk_tier text DEFAULT 'green'::text NOT NULL,
    partner_owner_id text,
    opportunity_id text,
    auto_opened_at timestamp without time zone,
    auto_opened_by_agent_run_id text,
    status text DEFAULT 'open'::text NOT NULL,
    closed_at timestamp without time zone,
    closed_by_user_id text,
    lost_reason text,
    rationale_text text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_renewal OWNER TO postgres;

--
-- Name: atelier_reports; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_reports (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    name text NOT NULL,
    template_id text NOT NULL,
    description text,
    parameters jsonb DEFAULT '{}'::jsonb NOT NULL,
    owner_user_id text,
    schedule text DEFAULT 'none'::text NOT NULL,
    schedule_channels jsonb DEFAULT '[]'::jsonb NOT NULL,
    pinned_to_home boolean DEFAULT false NOT NULL,
    last_run_at timestamp without time zone,
    last_run_snapshot jsonb,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_reports OWNER TO postgres;

--
-- Name: atelier_research_facts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_research_facts (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    opportunity_id text NOT NULL,
    run_id text,
    topic text NOT NULL,
    statement text NOT NULL,
    source_url text,
    source_title text,
    retrieved_at timestamp without time zone,
    confidence text DEFAULT 'amber'::text NOT NULL,
    snippet text,
    promoted boolean DEFAULT false NOT NULL,
    promoted_at timestamp without time zone,
    promoted_by_user_id text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone,
    included_in_brief boolean DEFAULT false NOT NULL,
    included_in_pov boolean DEFAULT false NOT NULL
);


ALTER TABLE public.atelier_research_facts OWNER TO postgres;

--
-- Name: atelier_revenue_adjustment; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_revenue_adjustment (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    posting_id text NOT NULL,
    engagement_id text NOT NULL,
    delta_amount double precision NOT NULL,
    currency text DEFAULT 'USD'::text NOT NULL,
    rationale_text text NOT NULL,
    requested_at timestamp without time zone DEFAULT now() NOT NULL,
    requested_by_user_id text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_revenue_adjustment OWNER TO postgres;

--
-- Name: atelier_revenue_method; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_revenue_method (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    engagement_id text NOT NULL,
    method text NOT NULL,
    basis text DEFAULT ''::text NOT NULL,
    currency text DEFAULT 'USD'::text NOT NULL,
    planned_total_amount double precision DEFAULT 0 NOT NULL,
    planned_hours double precision DEFAULT 0 NOT NULL,
    planned_cost double precision DEFAULT 0 NOT NULL,
    ratable_periods integer DEFAULT 0 NOT NULL,
    active_from text,
    active_to text,
    approved_at timestamp without time zone,
    approved_by_user_id text,
    notes text DEFAULT ''::text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_revenue_method OWNER TO postgres;

--
-- Name: atelier_revenue_milestone; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_revenue_milestone (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    engagement_id text NOT NULL,
    sequence integer DEFAULT 0 NOT NULL,
    name text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    planned_date text,
    planned_amount double precision DEFAULT 0 NOT NULL,
    contract_clause_id text,
    deliverable_acceptance_id text,
    status text DEFAULT 'pending'::text NOT NULL,
    claimed_at timestamp without time zone,
    claimed_by_user_id text,
    partner_attested_at timestamp without time zone,
    partner_attested_by_user_id text,
    client_accepted_at timestamp without time zone,
    earned_at timestamp without time zone,
    earned_amount double precision DEFAULT 0 NOT NULL,
    invoiceable_at timestamp without time zone,
    rationale_text text DEFAULT ''::text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_revenue_milestone OWNER TO postgres;

--
-- Name: atelier_revenue_period_posting; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_revenue_period_posting (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    period_label text NOT NULL,
    initiated_at timestamp without time zone DEFAULT now() NOT NULL,
    initiated_by_user_id text,
    posted_at timestamp without time zone,
    posted_by_user_id text,
    lines_count integer DEFAULT 0 NOT NULL,
    gross_recognised_amount double precision DEFAULT 0 NOT NULL,
    currency text DEFAULT 'USD'::text NOT NULL,
    rationale_text text DEFAULT ''::text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_revenue_period_posting OWNER TO postgres;

--
-- Name: atelier_revenue_period_posting_line; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_revenue_period_posting_line (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    posting_id text NOT NULL,
    engagement_id text NOT NULL,
    schedule_id text,
    kind text DEFAULT 'posting'::text NOT NULL,
    method text NOT NULL,
    recognised_amount double precision DEFAULT 0 NOT NULL,
    deferred_balance_ending double precision DEFAULT 0 NOT NULL,
    currency text DEFAULT 'USD'::text NOT NULL,
    adjustment_id text,
    notes text DEFAULT ''::text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_revenue_period_posting_line OWNER TO postgres;

--
-- Name: atelier_revenue_schedule; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_revenue_schedule (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    engagement_id text NOT NULL,
    period_label text NOT NULL,
    method text NOT NULL,
    basis_pct double precision DEFAULT 0 NOT NULL,
    recognised_amount double precision DEFAULT 0 NOT NULL,
    deferred_balance_ending double precision DEFAULT 0 NOT NULL,
    currency text DEFAULT 'USD'::text NOT NULL,
    computation_inputs_json jsonb DEFAULT '{}'::jsonb,
    computed_at timestamp without time zone DEFAULT now() NOT NULL,
    computed_by_agent_run_id text,
    frozen boolean DEFAULT false NOT NULL,
    frozen_at timestamp without time zone,
    frozen_by_user_id text,
    posting_id text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_revenue_schedule OWNER TO postgres;

--
-- Name: atelier_roster_reports_to; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_roster_reports_to (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    person_id text NOT NULL,
    manager_person_id text NOT NULL,
    created_by_user_id text,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.atelier_roster_reports_to OWNER TO postgres;

--
-- Name: atelier_salon_audit_events; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_salon_audit_events (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    engagement_id text NOT NULL,
    workspace_id text NOT NULL,
    salon_user_id text,
    actor_name text NOT NULL,
    action text NOT NULL,
    entity_type text,
    entity_id text,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    payload_summary text,
    ts timestamp without time zone DEFAULT now() NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_salon_audit_events OWNER TO postgres;

--
-- Name: atelier_salon_decisions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_salon_decisions (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    engagement_id text NOT NULL,
    workspace_id text NOT NULL,
    deliverable_id text,
    publish_id text,
    kind text NOT NULL,
    headline text NOT NULL,
    rationale text,
    decided_by_salon_user_id text NOT NULL,
    decided_by_name text NOT NULL,
    decided_at timestamp without time zone DEFAULT now() NOT NULL,
    status text DEFAULT 'recorded'::text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_salon_decisions OWNER TO postgres;

--
-- Name: atelier_salon_notifications; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_salon_notifications (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    salon_user_id text NOT NULL,
    engagement_id text NOT NULL,
    kind text NOT NULL,
    headline text NOT NULL,
    body text,
    href text,
    read_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_salon_notifications OWNER TO postgres;

--
-- Name: atelier_salon_requests; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_salon_requests (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    engagement_id text NOT NULL,
    workspace_id text NOT NULL,
    kind text NOT NULL,
    title text NOT NULL,
    detail text,
    related_deliverable_id text,
    raised_by_salon_user_id text NOT NULL,
    raised_by_name text NOT NULL,
    raised_at timestamp without time zone DEFAULT now() NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    assigned_to_atelier_user_id text,
    resolved_at timestamp without time zone,
    resolution_note text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_salon_requests OWNER TO postgres;

--
-- Name: atelier_salon_user_engagement_access; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_salon_user_engagement_access (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    salon_user_id text NOT NULL,
    engagement_id text NOT NULL,
    workspace_id text NOT NULL,
    role text DEFAULT 'viewer'::text NOT NULL,
    downloads_allowed boolean,
    can_approve boolean DEFAULT false NOT NULL,
    granted_by_atelier_user_id text,
    granted_at timestamp without time zone DEFAULT now() NOT NULL,
    revoked_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_salon_user_engagement_access OWNER TO postgres;

--
-- Name: atelier_salon_users; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_salon_users (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    account_id text NOT NULL,
    email text NOT NULL,
    name text NOT NULL,
    initials text NOT NULL,
    title text,
    avatar_url text,
    locale text DEFAULT 'en'::text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    invited_by_atelier_user_id text,
    invited_at timestamp without time zone,
    activated_at timestamp without time zone,
    last_seen_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_salon_users OWNER TO postgres;

--
-- Name: atelier_salon_workspaces; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_salon_workspaces (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    engagement_id text NOT NULL,
    account_id text NOT NULL,
    slug text NOT NULL,
    display_name text NOT NULL,
    accent_color text DEFAULT '#0B5CFF'::text NOT NULL,
    client_logo_url text,
    cognirise_logo_url text,
    eyebrow_text text,
    default_locale text DEFAULT 'en'::text NOT NULL,
    rtl_enabled boolean DEFAULT false NOT NULL,
    watermark_enabled boolean DEFAULT true NOT NULL,
    downloads_allowed_default boolean DEFAULT false NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_salon_workspaces OWNER TO postgres;

--
-- Name: atelier_self_notifications; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_self_notifications (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    user_id text NOT NULL,
    kind text DEFAULT 'generic'::text NOT NULL,
    title text NOT NULL,
    body text DEFAULT ''::text NOT NULL,
    href text,
    status text DEFAULT 'unread'::text NOT NULL,
    dismissed_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_self_notifications OWNER TO postgres;

--
-- Name: atelier_skills; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_skills (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    kind text NOT NULL,
    parent_id text,
    description text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_skills OWNER TO postgres;

--
-- Name: atelier_studio_candidates; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_studio_candidates (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    name text NOT NULL,
    "current_role" text DEFAULT ''::text NOT NULL,
    current_employer text DEFAULT ''::text NOT NULL,
    source text DEFAULT ''::text NOT NULL,
    role_title text NOT NULL,
    stage text NOT NULL,
    active_or_passive text NOT NULL,
    role_match_score double precision DEFAULT 0 NOT NULL,
    outreach_hook text DEFAULT ''::text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_studio_candidates OWNER TO postgres;

--
-- Name: atelier_studio_interview_panels; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_studio_interview_panels (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    candidate_name text NOT NULL,
    role_title text NOT NULL,
    scheduled_for text NOT NULL,
    status text NOT NULL,
    stages jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_studio_interview_panels OWNER TO postgres;

--
-- Name: atelier_studio_offers; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_studio_offers (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    candidate_name text NOT NULL,
    role_title text NOT NULL,
    jurisdiction text NOT NULL,
    start_date text NOT NULL,
    total_at_target_usd_k integer DEFAULT 0 NOT NULL,
    market_p25 integer DEFAULT 0 NOT NULL,
    market_p75 integer DEFAULT 0 NOT NULL,
    status text NOT NULL,
    band_flag text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_studio_offers OWNER TO postgres;

--
-- Name: atelier_studio_open_roles; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_studio_open_roles (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    title text NOT NULL,
    level text NOT NULL,
    location text NOT NULL,
    target_start text NOT NULL,
    urgency text NOT NULL,
    summary text DEFAULT ''::text NOT NULL,
    active_candidates integer DEFAULT 0 NOT NULL,
    panel_template text DEFAULT ''::text NOT NULL,
    scorecard_id text DEFAULT ''::text NOT NULL,
    take_home_id text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_studio_open_roles OWNER TO postgres;

--
-- Name: atelier_studio_reference_checks; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_studio_reference_checks (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    candidate_name text NOT NULL,
    referer_name text NOT NULL,
    relationship text DEFAULT ''::text NOT NULL,
    call_mode text NOT NULL,
    scheduled_for text NOT NULL,
    completed_at text,
    would_rehire text,
    fit_for_level text,
    headline_quote text DEFAULT ''::text NOT NULL,
    inconsistencies jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_studio_reference_checks OWNER TO postgres;

--
-- Name: atelier_studio_referrals; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_studio_referrals (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    referrer text NOT NULL,
    candidate text NOT NULL,
    via text DEFAULT ''::text NOT NULL,
    role_title text NOT NULL,
    status text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_studio_referrals OWNER TO postgres;

--
-- Name: atelier_sub_industries; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_sub_industries (
    code text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    industry_code text NOT NULL,
    display_name_en text NOT NULL,
    display_name_ar text,
    short_description text,
    display_order integer NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    default_offering_anchor text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text
);

ALTER TABLE ONLY public.atelier_sub_industries FORCE ROW LEVEL SECURITY;


ALTER TABLE public.atelier_sub_industries OWNER TO postgres;

--
-- Name: atelier_timesheet_entries; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_timesheet_entries (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    week_id text NOT NULL,
    person_id text NOT NULL,
    person_type text NOT NULL,
    work_date text NOT NULL,
    engagement_id text,
    activity_code text,
    hours double precision DEFAULT 0 NOT NULL,
    billable boolean DEFAULT false NOT NULL,
    narrative text,
    source text DEFAULT 'human'::text NOT NULL,
    drafted_by_agent_id text,
    signal_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);

ALTER TABLE ONLY public.atelier_timesheet_entries FORCE ROW LEVEL SECURITY;


ALTER TABLE public.atelier_timesheet_entries OWNER TO postgres;

--
-- Name: atelier_timesheet_signals; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_timesheet_signals (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    week_id text NOT NULL,
    person_id text NOT NULL,
    work_date text NOT NULL,
    signal_type text NOT NULL,
    source_ref_type text NOT NULL,
    source_ref_id text NOT NULL,
    engagement_hint text,
    evidence_summary text NOT NULL,
    weight_hours double precision DEFAULT 0 NOT NULL,
    observed_at timestamp without time zone DEFAULT now() NOT NULL,
    run_id text,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.atelier_timesheet_signals OWNER TO postgres;

--
-- Name: atelier_timesheet_weeks; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_timesheet_weeks (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    person_id text NOT NULL,
    person_type text NOT NULL,
    week_iso text NOT NULL,
    week_start_date text NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    submitted_at timestamp without time zone,
    submitted_by_user_id text,
    lead_approved_at timestamp without time zone,
    lead_approved_by_user_id text,
    partner_approved_at timestamp without time zone,
    partner_approved_by_user_id text,
    rejected_at timestamp without time zone,
    rejected_by_user_id text,
    rejection_reason text,
    total_hours double precision DEFAULT 0 NOT NULL,
    billable_hours double precision DEFAULT 0 NOT NULL,
    suspicious_flags jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_timesheet_weeks OWNER TO postgres;

--
-- Name: atelier_training_completions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_training_completions (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    material_id text NOT NULL,
    user_id text NOT NULL,
    completed_at timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.atelier_training_completions OWNER TO postgres;

--
-- Name: atelier_training_materials; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_training_materials (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    title text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    topic text DEFAULT ''::text NOT NULL,
    kind text NOT NULL,
    url text,
    object_key text,
    file_name text,
    mime text,
    size_bytes integer,
    audience text DEFAULT 'all'::text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_training_materials OWNER TO postgres;

--
-- Name: atelier_transcripts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_transcripts (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    source_file_url text,
    cleaned_text text,
    speaker_map jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);

ALTER TABLE ONLY public.atelier_transcripts FORCE ROW LEVEL SECURITY;


ALTER TABLE public.atelier_transcripts OWNER TO postgres;

--
-- Name: atelier_two_partner_countersign; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_two_partner_countersign (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    contract_id text NOT NULL,
    partner_a_user_id text NOT NULL,
    partner_b_user_id text NOT NULL,
    partner_a_signed_at timestamp without time zone,
    partner_b_signed_at timestamp without time zone,
    state text DEFAULT 'pending'::text NOT NULL,
    rationale_text text DEFAULT ''::text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_two_partner_countersign OWNER TO postgres;

--
-- Name: atelier_unbilled_wip_snapshot; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_unbilled_wip_snapshot (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    snapshot_at timestamp without time zone DEFAULT now() NOT NULL,
    engagement_id text NOT NULL,
    hours_burned double precision DEFAULT 0 NOT NULL,
    expense_burned double precision DEFAULT 0 NOT NULL,
    recognised_revenue double precision DEFAULT 0 NOT NULL,
    invoiced_amount double precision DEFAULT 0 NOT NULL,
    unbilled_amount double precision DEFAULT 0 NOT NULL,
    currency text DEFAULT 'USD'::text NOT NULL,
    run_log_id text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_unbilled_wip_snapshot OWNER TO postgres;

--
-- Name: atelier_users; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_users (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    email text NOT NULL,
    name text NOT NULL,
    initials text NOT NULL,
    role text NOT NULL,
    role_label text NOT NULL,
    title text NOT NULL,
    avatar_url text,
    permissions jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone,
    legacy_role text,
    bd_active boolean DEFAULT false NOT NULL
);

ALTER TABLE ONLY public.atelier_users FORCE ROW LEVEL SECURITY;


ALTER TABLE public.atelier_users OWNER TO postgres;

--
-- Name: atelier_utilization_snapshots; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_utilization_snapshots (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    person_id text NOT NULL,
    person_type text DEFAULT 'employee'::text NOT NULL,
    week_iso text NOT NULL,
    week_start_date text NOT NULL,
    billable_hours double precision DEFAULT 0 NOT NULL,
    internal_hours double precision DEFAULT 0 NOT NULL,
    leave_hours double precision DEFAULT 0 NOT NULL,
    total_hours double precision DEFAULT 0 NOT NULL,
    available_hours double precision DEFAULT 40 NOT NULL,
    utilization_pct double precision DEFAULT 0 NOT NULL,
    target_pct double precision DEFAULT 0 NOT NULL,
    engagement_mix jsonb DEFAULT '[]'::jsonb NOT NULL,
    computed_at timestamp without time zone DEFAULT now() NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.atelier_utilization_snapshots OWNER TO postgres;

--
-- Name: atelier_vat_register; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_vat_register (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    expense_id text NOT NULL,
    correction_of_id text,
    expense_date text NOT NULL,
    country text NOT NULL,
    treatment text NOT NULL,
    rate double precision DEFAULT 0 NOT NULL,
    net_amount double precision DEFAULT 0 NOT NULL,
    vat_amount double precision DEFAULT 0 NOT NULL,
    gross_amount double precision DEFAULT 0 NOT NULL,
    currency text DEFAULT 'USD'::text NOT NULL,
    usd_net double precision DEFAULT 0 NOT NULL,
    usd_vat double precision DEFAULT 0 NOT NULL,
    usd_gross double precision DEFAULT 0 NOT NULL,
    merchant text,
    summary text,
    recorded_at timestamp without time zone DEFAULT now() NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    country_code text
);


ALTER TABLE public.atelier_vat_register OWNER TO postgres;

--
-- Name: atelier_win_themes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_win_themes (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    name text NOT NULL,
    description text NOT NULL,
    tag text NOT NULL,
    polarity text DEFAULT 'win'::text NOT NULL,
    support_count integer DEFAULT 0 NOT NULL,
    contributing_debrief_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    offering_tags jsonb DEFAULT '[]'::jsonb NOT NULL,
    sector_tags jsonb DEFAULT '[]'::jsonb NOT NULL,
    positioning_line text,
    last_seen_at timestamp without time zone,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone,
    sector_industry_codes jsonb DEFAULT '[]'::jsonb NOT NULL
);


ALTER TABLE public.atelier_win_themes OWNER TO postgres;

--
-- Name: atelier_winloss_debriefs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_winloss_debriefs (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    opportunity_id text NOT NULL,
    outcome text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    seller_inputs jsonb DEFAULT '[]'::jsonb NOT NULL,
    seller_perceived_reasons jsonb DEFAULT '[]'::jsonb NOT NULL,
    seller_done_at timestamp without time zone,
    buyer_interview_scheduled_at timestamp without time zone,
    buyer_interview_conducted_by_agent_run_id text,
    buyer_interview_conducted_by_user_id text,
    buyer_transcript text,
    buyer_transcript_uploaded_at timestamp without time zone,
    buyer_responses jsonb,
    buyer_authentic_reasons jsonb DEFAULT '[]'::jsonb NOT NULL,
    hidden_competitor text,
    themes jsonb DEFAULT '[]'::jsonb NOT NULL,
    what_we_would_do_differently text,
    lessons_to_atelier_asset_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    interviewer_run_id text,
    conductor_role text,
    published_at timestamp without time zone,
    published_by_user_id text,
    due_at timestamp without time zone,
    overdue_red_at timestamp without time zone,
    closed_without_debrief_override_rationale text,
    closed_without_debrief_override_by_user_id text,
    closed_without_debrief_override_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone,
    seller_notes text,
    partner_owner_user_id text,
    engagement_lead_user_id text,
    suggested_atelier_lessons jsonb DEFAULT '[]'::jsonb NOT NULL,
    last_run_id text,
    synthesized_at timestamp without time zone,
    approved_at timestamp without time zone,
    approved_by_user_id text
);


ALTER TABLE public.atelier_winloss_debriefs OWNER TO postgres;

--
-- Name: atelier_wip_snapshot_run_log; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.atelier_wip_snapshot_run_log (
    id text NOT NULL,
    org_id text DEFAULT 'aico'::text NOT NULL,
    started_at timestamp without time zone DEFAULT now() NOT NULL,
    finished_at timestamp without time zone,
    engagements_scanned integer DEFAULT 0 NOT NULL,
    snapshots_written integer DEFAULT 0 NOT NULL,
    status text DEFAULT 'running'::text NOT NULL,
    error_text text DEFAULT ''::text NOT NULL,
    triggered_by_user_id text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    deleted_at timestamp without time zone
);


ALTER TABLE public.atelier_wip_snapshot_run_log OWNER TO postgres;

--
-- Name: call_requests; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.call_requests (
    id integer NOT NULL,
    submission_public_id text,
    name text NOT NULL,
    email text NOT NULL,
    company text NOT NULL,
    role text,
    preferred_time text,
    message text,
    language text DEFAULT 'en'::text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.call_requests OWNER TO postgres;

--
-- Name: call_requests_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.call_requests_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.call_requests_id_seq OWNER TO postgres;

--
-- Name: call_requests_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.call_requests_id_seq OWNED BY public.call_requests.id;


--
-- Name: tasama_agent_performance; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.tasama_agent_performance (
    id text NOT NULL,
    agent_id text NOT NULL,
    period_year integer NOT NULL,
    period_month integer NOT NULL,
    accuracy double precision NOT NULL,
    speed double precision NOT NULL,
    autonomy double precision NOT NULL,
    quality double precision NOT NULL,
    composite double precision NOT NULL,
    tasks_processed integer NOT NULL,
    human_overrides integer NOT NULL,
    escalations integer NOT NULL,
    avg_latency_seconds double precision NOT NULL,
    error_count integer NOT NULL,
    notable_events jsonb NOT NULL
);


ALTER TABLE public.tasama_agent_performance OWNER TO postgres;

--
-- Name: tasama_clients; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.tasama_clients (
    id text NOT NULL,
    legal_name_en text NOT NULL,
    legal_name_ar text NOT NULL,
    industry text NOT NULL,
    employee_count integer NOT NULL,
    saudi_count integer NOT NULL,
    expat_count integer NOT NULL,
    saudization_band text NOT NULL,
    saudization_percent double precision NOT NULL,
    monthly_payroll_gross integer NOT NULL,
    contact_name text NOT NULL,
    contact_email text NOT NULL,
    active_events jsonb NOT NULL,
    onboarded_at text NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    payroll_cutoff_day integer DEFAULT 25 NOT NULL
);


ALTER TABLE public.tasama_clients OWNER TO postgres;

--
-- Name: tasama_documents; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.tasama_documents (
    id text NOT NULL,
    client_id text NOT NULL,
    employee_id text,
    type text NOT NULL,
    title_en text NOT NULL,
    title_ar text NOT NULL,
    reference_number text NOT NULL,
    issued_at text NOT NULL,
    signed_by_name text NOT NULL,
    signed_by_title text NOT NULL,
    language text DEFAULT 'bilingual'::text NOT NULL,
    filename text NOT NULL,
    mime_type text DEFAULT 'application/pdf'::text NOT NULL,
    size_bytes integer DEFAULT 0 NOT NULL,
    extracted_fields jsonb NOT NULL,
    overall_confidence double precision NOT NULL,
    storage_path text NOT NULL,
    processed_at text NOT NULL
);


ALTER TABLE public.tasama_documents OWNER TO postgres;

--
-- Name: tasama_employees; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.tasama_employees (
    id text NOT NULL,
    client_id text NOT NULL,
    full_name_en text NOT NULL,
    full_name_ar text NOT NULL,
    nationality text NOT NULL,
    is_saudi boolean NOT NULL,
    role text NOT NULL,
    role_ar text NOT NULL,
    department text NOT NULL,
    hire_date text NOT NULL,
    years_of_service double precision NOT NULL,
    status text NOT NULL,
    contract_type text NOT NULL,
    iqama_number text,
    national_id text,
    iban text NOT NULL,
    bank_name text NOT NULL,
    email text NOT NULL,
    phone text NOT NULL,
    story_tags jsonb NOT NULL,
    notes text
);


ALTER TABLE public.tasama_employees OWNER TO postgres;

--
-- Name: tasama_eosb_provisions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.tasama_eosb_provisions (
    id text NOT NULL,
    employee_id text NOT NULL,
    client_id text NOT NULL,
    period_year integer NOT NULL,
    period_month integer NOT NULL,
    years_of_service double precision NOT NULL,
    last_basic_plus_housing integer NOT NULL,
    accrued_this_month integer NOT NULL,
    cumulative_provision integer NOT NULL,
    estimated_full_payout integer NOT NULL
);


ALTER TABLE public.tasama_eosb_provisions OWNER TO postgres;

--
-- Name: tasama_gosi_records; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.tasama_gosi_records (
    id text NOT NULL,
    employee_id text NOT NULL,
    client_id text NOT NULL,
    period_year integer NOT NULL,
    period_month integer NOT NULL,
    is_saudi boolean NOT NULL,
    basic_plus_housing integer NOT NULL,
    employer_annuity integer NOT NULL,
    employee_annuity integer NOT NULL,
    ohrp_employer integer NOT NULL,
    total_employer integer NOT NULL,
    total_employee integer NOT NULL,
    filing_status text NOT NULL,
    filed_at text,
    filing_reference text
);


ALTER TABLE public.tasama_gosi_records OWNER TO postgres;

--
-- Name: tasama_leave_balances; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.tasama_leave_balances (
    id text NOT NULL,
    employee_id text NOT NULL,
    annual_entitlement integer NOT NULL,
    annual_used integer NOT NULL,
    annual_remaining integer NOT NULL,
    sick_used_days integer NOT NULL,
    other_leave_used jsonb NOT NULL,
    pending_requests jsonb NOT NULL,
    as_of_date text NOT NULL
);


ALTER TABLE public.tasama_leave_balances OWNER TO postgres;

--
-- Name: tasama_payroll_runs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.tasama_payroll_runs (
    id text NOT NULL,
    client_id text NOT NULL,
    period_year integer NOT NULL,
    period_month integer NOT NULL,
    run_date text NOT NULL,
    status text NOT NULL,
    total_gross integer NOT NULL,
    total_net integer NOT NULL,
    total_gosi_employer integer NOT NULL,
    total_gosi_employee integer NOT NULL,
    employee_count integer NOT NULL,
    approved_by text,
    approved_at text,
    settled_at text,
    mudad_batch_ref text,
    notes text
);


ALTER TABLE public.tasama_payroll_runs OWNER TO postgres;

--
-- Name: tasama_payslips; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.tasama_payslips (
    id text NOT NULL,
    run_id text NOT NULL,
    employee_id text NOT NULL,
    client_id text NOT NULL,
    period_year integer NOT NULL,
    period_month integer NOT NULL,
    basic_salary integer NOT NULL,
    housing_allowance integer NOT NULL,
    transport_allowance integer NOT NULL,
    other_allowances integer NOT NULL,
    overtime integer DEFAULT 0 NOT NULL,
    bonus integer DEFAULT 0 NOT NULL,
    retro_adjustment integer DEFAULT 0 NOT NULL,
    gross_pay integer NOT NULL,
    gosi_employee_deduction integer NOT NULL,
    other_deductions integer DEFAULT 0 NOT NULL,
    net_pay integer NOT NULL,
    payment_status text NOT NULL,
    payment_date text,
    mudad_ref text
);


ALTER TABLE public.tasama_payslips OWNER TO postgres;

--
-- Name: tasama_regulatory_calendar; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.tasama_regulatory_calendar (
    id text NOT NULL,
    event_type text NOT NULL,
    name_en text NOT NULL,
    name_ar text NOT NULL,
    client_id text,
    employee_id text,
    due_date text NOT NULL,
    type text NOT NULL,
    description_en text NOT NULL,
    description_ar text NOT NULL,
    reference_number text,
    completed_at text
);


ALTER TABLE public.tasama_regulatory_calendar OWNER TO postgres;

--
-- Name: tasama_salary_components; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.tasama_salary_components (
    id text NOT NULL,
    employee_id text NOT NULL,
    basic_salary integer NOT NULL,
    housing_allowance integer NOT NULL,
    transport_allowance integer NOT NULL,
    other_allowances jsonb NOT NULL,
    gross_monthly integer NOT NULL,
    effective_from text NOT NULL,
    effective_to text
);


ALTER TABLE public.tasama_salary_components OWNER TO postgres;

--
-- Name: tasama_service_requests; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.tasama_service_requests (
    id text NOT NULL,
    client_id text NOT NULL,
    employee_id text,
    type text NOT NULL,
    title_en text NOT NULL,
    title_ar text NOT NULL,
    description text NOT NULL,
    description_ar text NOT NULL,
    status text NOT NULL,
    priority text NOT NULL,
    requested_by text NOT NULL,
    requested_at text NOT NULL,
    assigned_agent text,
    completed_at text,
    payload jsonb NOT NULL,
    sla_target_hours integer NOT NULL
);


ALTER TABLE public.tasama_service_requests OWNER TO postgres;

--
-- Name: team_invitations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.team_invitations (
    id integer NOT NULL,
    team_token text NOT NULL,
    slug text NOT NULL,
    initiator_name text NOT NULL,
    initiator_email text NOT NULL,
    company text NOT NULL,
    seats integer DEFAULT 10 NOT NULL,
    expires_at timestamp without time zone,
    closed boolean DEFAULT false NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.team_invitations OWNER TO postgres;

--
-- Name: team_invitations_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.team_invitations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.team_invitations_id_seq OWNER TO postgres;

--
-- Name: team_invitations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.team_invitations_id_seq OWNED BY public.team_invitations.id;


--
-- Name: arcelik_marketplace_price_history id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.arcelik_marketplace_price_history ALTER COLUMN id SET DEFAULT nextval('public.arcelik_marketplace_price_history_id_seq'::regclass);


--
-- Name: arcelik_marketplace_prices id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.arcelik_marketplace_prices ALTER COLUMN id SET DEFAULT nextval('public.arcelik_marketplace_prices_id_seq'::regclass);


--
-- Name: arcelik_price_history id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.arcelik_price_history ALTER COLUMN id SET DEFAULT nextval('public.arcelik_price_history_id_seq'::regclass);


--
-- Name: arcelik_product_equivalences id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.arcelik_product_equivalences ALTER COLUMN id SET DEFAULT nextval('public.arcelik_product_equivalences_id_seq'::regclass);


--
-- Name: arcelik_product_specs id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.arcelik_product_specs ALTER COLUMN id SET DEFAULT nextval('public.arcelik_product_specs_id_seq'::regclass);


--
-- Name: assessment_submissions id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.assessment_submissions ALTER COLUMN id SET DEFAULT nextval('public.assessment_submissions_id_seq'::regclass);


--
-- Name: call_requests id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.call_requests ALTER COLUMN id SET DEFAULT nextval('public.call_requests_id_seq'::regclass);


--
-- Name: team_invitations id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.team_invitations ALTER COLUMN id SET DEFAULT nextval('public.team_invitations_id_seq'::regclass);


--
-- Name: arcelik_calendar arcelik_calendar_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.arcelik_calendar
    ADD CONSTRAINT arcelik_calendar_pkey PRIMARY KEY (id);


--
-- Name: arcelik_campaigns arcelik_campaigns_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.arcelik_campaigns
    ADD CONSTRAINT arcelik_campaigns_pkey PRIMARY KEY (id);


--
-- Name: arcelik_cities arcelik_cities_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.arcelik_cities
    ADD CONSTRAINT arcelik_cities_pkey PRIMARY KEY (id);


--
-- Name: arcelik_competitor_prices arcelik_competitor_prices_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.arcelik_competitor_prices
    ADD CONSTRAINT arcelik_competitor_prices_pkey PRIMARY KEY (id);


--
-- Name: arcelik_data_sources arcelik_data_sources_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.arcelik_data_sources
    ADD CONSTRAINT arcelik_data_sources_pkey PRIMARY KEY (id);


--
-- Name: arcelik_dealers arcelik_dealers_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.arcelik_dealers
    ADD CONSTRAINT arcelik_dealers_pkey PRIMARY KEY (id);


--
-- Name: arcelik_kpi_benchmarks arcelik_kpi_benchmarks_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.arcelik_kpi_benchmarks
    ADD CONSTRAINT arcelik_kpi_benchmarks_pkey PRIMARY KEY (id);


--
-- Name: arcelik_marketplace_price_history arcelik_marketplace_price_history_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.arcelik_marketplace_price_history
    ADD CONSTRAINT arcelik_marketplace_price_history_pkey PRIMARY KEY (id);


--
-- Name: arcelik_marketplace_prices arcelik_marketplace_prices_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.arcelik_marketplace_prices
    ADD CONSTRAINT arcelik_marketplace_prices_pkey PRIMARY KEY (id);


--
-- Name: arcelik_price_history arcelik_price_history_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.arcelik_price_history
    ADD CONSTRAINT arcelik_price_history_pkey PRIMARY KEY (id);


--
-- Name: arcelik_product_equivalences arcelik_product_equivalences_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.arcelik_product_equivalences
    ADD CONSTRAINT arcelik_product_equivalences_pkey PRIMARY KEY (id);


--
-- Name: arcelik_product_specs arcelik_product_specs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.arcelik_product_specs
    ADD CONSTRAINT arcelik_product_specs_pkey PRIMARY KEY (id);


--
-- Name: arcelik_products arcelik_products_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.arcelik_products
    ADD CONSTRAINT arcelik_products_pkey PRIMARY KEY (id);


--
-- Name: arcelik_scrape_logs arcelik_scrape_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.arcelik_scrape_logs
    ADD CONSTRAINT arcelik_scrape_logs_pkey PRIMARY KEY (id);


--
-- Name: assessment_submissions assessment_submissions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.assessment_submissions
    ADD CONSTRAINT assessment_submissions_pkey PRIMARY KEY (id);


--
-- Name: assessment_submissions assessment_submissions_public_id_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.assessment_submissions
    ADD CONSTRAINT assessment_submissions_public_id_unique UNIQUE (public_id);


--
-- Name: atelier_account_actions atelier_account_actions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_account_actions
    ADD CONSTRAINT atelier_account_actions_pkey PRIMARY KEY (id);


--
-- Name: atelier_account_goal_progress atelier_account_goal_progress_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_account_goal_progress
    ADD CONSTRAINT atelier_account_goal_progress_pkey PRIMARY KEY (id);


--
-- Name: atelier_account_insights atelier_account_insights_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_account_insights
    ADD CONSTRAINT atelier_account_insights_pkey PRIMARY KEY (id);


--
-- Name: atelier_account_risks atelier_account_risks_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_account_risks
    ADD CONSTRAINT atelier_account_risks_pkey PRIMARY KEY (id);


--
-- Name: atelier_account_team_members atelier_account_team_members_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_account_team_members
    ADD CONSTRAINT atelier_account_team_members_pkey PRIMARY KEY (id);


--
-- Name: atelier_accounts atelier_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_accounts
    ADD CONSTRAINT atelier_accounts_pkey PRIMARY KEY (id);


--
-- Name: atelier_activities atelier_activities_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_activities
    ADD CONSTRAINT atelier_activities_pkey PRIMARY KEY (id);


--
-- Name: atelier_admin_settings atelier_admin_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_admin_settings
    ADD CONSTRAINT atelier_admin_settings_pkey PRIMARY KEY (org_id);


--
-- Name: atelier_agent_deployments atelier_agent_deployments_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_agent_deployments
    ADD CONSTRAINT atelier_agent_deployments_pkey PRIMARY KEY (id);


--
-- Name: atelier_agent_designs atelier_agent_designs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_agent_designs
    ADD CONSTRAINT atelier_agent_designs_pkey PRIMARY KEY (id);


--
-- Name: atelier_agent_eval_suites atelier_agent_eval_suites_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_agent_eval_suites
    ADD CONSTRAINT atelier_agent_eval_suites_pkey PRIMARY KEY (id);


--
-- Name: atelier_agent_incidents atelier_agent_incidents_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_agent_incidents
    ADD CONSTRAINT atelier_agent_incidents_pkey PRIMARY KEY (id);


--
-- Name: atelier_agent_retirements atelier_agent_retirements_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_agent_retirements
    ADD CONSTRAINT atelier_agent_retirements_pkey PRIMARY KEY (id);


--
-- Name: atelier_agent_runs atelier_agent_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_agent_runs
    ADD CONSTRAINT atelier_agent_runs_pkey PRIMARY KEY (id);


--
-- Name: atelier_agent_specs atelier_agent_specs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_agent_specs
    ADD CONSTRAINT atelier_agent_specs_pkey PRIMARY KEY (id);


--
-- Name: atelier_agent_versions atelier_agent_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_agent_versions
    ADD CONSTRAINT atelier_agent_versions_pkey PRIMARY KEY (id);


--
-- Name: atelier_agents atelier_agents_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_agents
    ADD CONSTRAINT atelier_agents_pkey PRIMARY KEY (id);


--
-- Name: atelier_alliance_certifications atelier_alliance_certifications_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_alliance_certifications
    ADD CONSTRAINT atelier_alliance_certifications_pkey PRIMARY KEY (id);


--
-- Name: atelier_alliance_conflicts atelier_alliance_conflicts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_alliance_conflicts
    ADD CONSTRAINT atelier_alliance_conflicts_pkey PRIMARY KEY (id);


--
-- Name: atelier_alliance_joint_pipeline atelier_alliance_joint_pipeline_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_alliance_joint_pipeline
    ADD CONSTRAINT atelier_alliance_joint_pipeline_pkey PRIMARY KEY (id);


--
-- Name: atelier_alliance_partner_firms atelier_alliance_partner_firms_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_alliance_partner_firms
    ADD CONSTRAINT atelier_alliance_partner_firms_pkey PRIMARY KEY (id);


--
-- Name: atelier_artifacts atelier_artifacts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_artifacts
    ADD CONSTRAINT atelier_artifacts_pkey PRIMARY KEY (id);


--
-- Name: atelier_assets atelier_assets_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_assets
    ADD CONSTRAINT atelier_assets_pkey PRIMARY KEY (id);


--
-- Name: atelier_audit_events atelier_audit_events_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_audit_events
    ADD CONSTRAINT atelier_audit_events_pkey PRIMARY KEY (id);


--
-- Name: atelier_auth_credentials atelier_auth_credentials_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_auth_credentials
    ADD CONSTRAINT atelier_auth_credentials_pkey PRIMARY KEY (email);


--
-- Name: atelier_auth_sessions atelier_auth_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_auth_sessions
    ADD CONSTRAINT atelier_auth_sessions_pkey PRIMARY KEY (token_hash);


--
-- Name: atelier_bank_account atelier_bank_account_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_bank_account
    ADD CONSTRAINT atelier_bank_account_pkey PRIMARY KEY (id);


--
-- Name: atelier_bank_change_requests atelier_bank_change_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_bank_change_requests
    ADD CONSTRAINT atelier_bank_change_requests_pkey PRIMARY KEY (id);


--
-- Name: atelier_bank_recon_period atelier_bank_recon_period_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_bank_recon_period
    ADD CONSTRAINT atelier_bank_recon_period_pkey PRIMARY KEY (id);


--
-- Name: atelier_bank_statement_import atelier_bank_statement_import_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_bank_statement_import
    ADD CONSTRAINT atelier_bank_statement_import_pkey PRIMARY KEY (id);


--
-- Name: atelier_bank_transaction atelier_bank_transaction_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_bank_transaction
    ADD CONSTRAINT atelier_bank_transaction_pkey PRIMARY KEY (id);


--
-- Name: atelier_briefs atelier_briefs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_briefs
    ADD CONSTRAINT atelier_briefs_pkey PRIMARY KEY (id);


--
-- Name: atelier_calendar_events atelier_calendar_events_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_calendar_events
    ADD CONSTRAINT atelier_calendar_events_pkey PRIMARY KEY (id);


--
-- Name: atelier_capability_embeddings atelier_capability_embeddings_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_capability_embeddings
    ADD CONSTRAINT atelier_capability_embeddings_pkey PRIMARY KEY (capability_id);


--
-- Name: atelier_cash_application atelier_cash_application_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_cash_application
    ADD CONSTRAINT atelier_cash_application_pkey PRIMARY KEY (id);


--
-- Name: atelier_cash_audit atelier_cash_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_cash_audit
    ADD CONSTRAINT atelier_cash_audit_pkey PRIMARY KEY (id);


--
-- Name: atelier_cash_forecast_snapshot atelier_cash_forecast_snapshot_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_cash_forecast_snapshot
    ADD CONSTRAINT atelier_cash_forecast_snapshot_pkey PRIMARY KEY (id);


--
-- Name: atelier_cash_line_overrides atelier_cash_line_overrides_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_cash_line_overrides
    ADD CONSTRAINT atelier_cash_line_overrides_pkey PRIMARY KEY (line_id);


--
-- Name: atelier_cash_receipt atelier_cash_receipt_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_cash_receipt
    ADD CONSTRAINT atelier_cash_receipt_pkey PRIMARY KEY (id);


--
-- Name: atelier_change_order atelier_change_order_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_change_order
    ADD CONSTRAINT atelier_change_order_pkey PRIMARY KEY (id);


--
-- Name: atelier_charter_versions atelier_charter_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_charter_versions
    ADD CONSTRAINT atelier_charter_versions_pkey PRIMARY KEY (id);


--
-- Name: atelier_clause_acceptance atelier_clause_acceptance_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_clause_acceptance
    ADD CONSTRAINT atelier_clause_acceptance_pkey PRIMARY KEY (id);


--
-- Name: atelier_clause atelier_clause_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_clause
    ADD CONSTRAINT atelier_clause_pkey PRIMARY KEY (id);


--
-- Name: atelier_cli_attachments atelier_cli_attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_cli_attachments
    ADD CONSTRAINT atelier_cli_attachments_pkey PRIMARY KEY (id);


--
-- Name: atelier_cli_jobs atelier_cli_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_cli_jobs
    ADD CONSTRAINT atelier_cli_jobs_pkey PRIMARY KEY (id);


--
-- Name: atelier_cli_sessions atelier_cli_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_cli_sessions
    ADD CONSTRAINT atelier_cli_sessions_pkey PRIMARY KEY (id);


--
-- Name: atelier_cli_turns atelier_cli_turns_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_cli_turns
    ADD CONSTRAINT atelier_cli_turns_pkey PRIMARY KEY (id);


--
-- Name: atelier_compliance_records atelier_compliance_records_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_compliance_records
    ADD CONSTRAINT atelier_compliance_records_pkey PRIMARY KEY (id);


--
-- Name: atelier_conflict_disclosures atelier_conflict_disclosures_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_conflict_disclosures
    ADD CONSTRAINT atelier_conflict_disclosures_pkey PRIMARY KEY (id);


--
-- Name: atelier_contact_relationships atelier_contact_relationships_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_contact_relationships
    ADD CONSTRAINT atelier_contact_relationships_pkey PRIMARY KEY (id);


--
-- Name: atelier_contacts atelier_contacts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_contacts
    ADD CONSTRAINT atelier_contacts_pkey PRIMARY KEY (id);


--
-- Name: atelier_contract_clause atelier_contract_clause_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_contract_clause
    ADD CONSTRAINT atelier_contract_clause_pkey PRIMARY KEY (id);


--
-- Name: atelier_contract_party atelier_contract_party_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_contract_party
    ADD CONSTRAINT atelier_contract_party_pkey PRIMARY KEY (id);


--
-- Name: atelier_contract atelier_contract_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_contract
    ADD CONSTRAINT atelier_contract_pkey PRIMARY KEY (id);


--
-- Name: atelier_contract_redline atelier_contract_redline_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_contract_redline
    ADD CONSTRAINT atelier_contract_redline_pkey PRIMARY KEY (id);


--
-- Name: atelier_contract_version atelier_contract_version_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_contract_version
    ADD CONSTRAINT atelier_contract_version_pkey PRIMARY KEY (id);


--
-- Name: atelier_contractor_payments atelier_contractor_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_contractor_payments
    ADD CONSTRAINT atelier_contractor_payments_pkey PRIMARY KEY (id);


--
-- Name: atelier_contractors atelier_contractors_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_contractors
    ADD CONSTRAINT atelier_contractors_pkey PRIMARY KEY (id);


--
-- Name: atelier_corporate_cards atelier_corporate_cards_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_corporate_cards
    ADD CONSTRAINT atelier_corporate_cards_pkey PRIMARY KEY (id);


--
-- Name: atelier_counterparty atelier_counterparty_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_counterparty
    ADD CONSTRAINT atelier_counterparty_pkey PRIMARY KEY (id);


--
-- Name: atelier_countries atelier_countries_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_countries
    ADD CONSTRAINT atelier_countries_pkey PRIMARY KEY (iso_alpha_2);


--
-- Name: atelier_credentials atelier_credentials_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_credentials
    ADD CONSTRAINT atelier_credentials_pkey PRIMARY KEY (id);


--
-- Name: atelier_deal_pricings atelier_deal_pricings_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_deal_pricings
    ADD CONSTRAINT atelier_deal_pricings_pkey PRIMARY KEY (id);


--
-- Name: atelier_deliverable_acceptance atelier_deliverable_acceptance_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_deliverable_acceptance
    ADD CONSTRAINT atelier_deliverable_acceptance_pkey PRIMARY KEY (id);


--
-- Name: atelier_deliverable_publishes atelier_deliverable_publishes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_deliverable_publishes
    ADD CONSTRAINT atelier_deliverable_publishes_pkey PRIMARY KEY (id);


--
-- Name: atelier_deliverable_versions atelier_deliverable_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_deliverable_versions
    ADD CONSTRAINT atelier_deliverable_versions_pkey PRIMARY KEY (id);


--
-- Name: atelier_deliverables atelier_deliverables_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_deliverables
    ADD CONSTRAINT atelier_deliverables_pkey PRIMARY KEY (id);


--
-- Name: atelier_dependents atelier_dependents_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_dependents
    ADD CONSTRAINT atelier_dependents_pkey PRIMARY KEY (id);


--
-- Name: atelier_document_chunk_embeddings atelier_document_chunk_embeddings_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_document_chunk_embeddings
    ADD CONSTRAINT atelier_document_chunk_embeddings_pkey PRIMARY KEY (chunk_id);


--
-- Name: atelier_dpa atelier_dpa_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_dpa
    ADD CONSTRAINT atelier_dpa_pkey PRIMARY KEY (id);


--
-- Name: atelier_dunning_event atelier_dunning_event_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_dunning_event
    ADD CONSTRAINT atelier_dunning_event_pkey PRIMARY KEY (id);


--
-- Name: atelier_dunning_ladder atelier_dunning_ladder_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_dunning_ladder
    ADD CONSTRAINT atelier_dunning_ladder_pkey PRIMARY KEY (id);


--
-- Name: atelier_einvoice_submission atelier_einvoice_submission_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_einvoice_submission
    ADD CONSTRAINT atelier_einvoice_submission_pkey PRIMARY KEY (id);


--
-- Name: atelier_emergency_contacts atelier_emergency_contacts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_emergency_contacts
    ADD CONSTRAINT atelier_emergency_contacts_pkey PRIMARY KEY (id);


--
-- Name: atelier_employees atelier_employees_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_employees
    ADD CONSTRAINT atelier_employees_pkey PRIMARY KEY (id);


--
-- Name: atelier_engagement_access atelier_engagement_access_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_engagement_access
    ADD CONSTRAINT atelier_engagement_access_pkey PRIMARY KEY (id);


--
-- Name: atelier_engagement_budget atelier_engagement_budget_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_engagement_budget
    ADD CONSTRAINT atelier_engagement_budget_pkey PRIMARY KEY (engagement_id);


--
-- Name: atelier_engagement_cost_to_date atelier_engagement_cost_to_date_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_engagement_cost_to_date
    ADD CONSTRAINT atelier_engagement_cost_to_date_pkey PRIMARY KEY (engagement_id);


--
-- Name: atelier_engagement_etc atelier_engagement_etc_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_engagement_etc
    ADD CONSTRAINT atelier_engagement_etc_pkey PRIMARY KEY (engagement_id);


--
-- Name: atelier_engagement_margin_snapshot atelier_engagement_margin_snapshot_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_engagement_margin_snapshot
    ADD CONSTRAINT atelier_engagement_margin_snapshot_pkey PRIMARY KEY (id);


--
-- Name: atelier_engagement_pnl_audit atelier_engagement_pnl_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_engagement_pnl_audit
    ADD CONSTRAINT atelier_engagement_pnl_audit_pkey PRIMARY KEY (id);


--
-- Name: atelier_engagement_pnl_change_order atelier_engagement_pnl_change_order_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_engagement_pnl_change_order
    ADD CONSTRAINT atelier_engagement_pnl_change_order_pkey PRIMARY KEY (id);


--
-- Name: atelier_engagements atelier_engagements_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_engagements
    ADD CONSTRAINT atelier_engagements_pkey PRIMARY KEY (id);


--
-- Name: atelier_entity_embeddings atelier_entity_embeddings_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_entity_embeddings
    ADD CONSTRAINT atelier_entity_embeddings_pkey PRIMARY KEY (id);


--
-- Name: atelier_expense_policies atelier_expense_policies_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_expense_policies
    ADD CONSTRAINT atelier_expense_policies_pkey PRIMARY KEY (id);


--
-- Name: atelier_expenses atelier_expenses_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_expenses
    ADD CONSTRAINT atelier_expenses_pkey PRIMARY KEY (id);


--
-- Name: atelier_extracted_documents atelier_extracted_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_extracted_documents
    ADD CONSTRAINT atelier_extracted_documents_pkey PRIMARY KEY (id);


--
-- Name: atelier_finance_plan_commits atelier_finance_plan_commits_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_finance_plan_commits
    ADD CONSTRAINT atelier_finance_plan_commits_pkey PRIMARY KEY (id);


--
-- Name: atelier_firm_profile atelier_firm_profile_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_firm_profile
    ADD CONSTRAINT atelier_firm_profile_pkey PRIMARY KEY (id);


--
-- Name: atelier_fx_rates atelier_fx_rates_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_fx_rates
    ADD CONSTRAINT atelier_fx_rates_pkey PRIMARY KEY (id);


--
-- Name: atelier_guardhouse_backups atelier_guardhouse_backups_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_guardhouse_backups
    ADD CONSTRAINT atelier_guardhouse_backups_pkey PRIMARY KEY (id);


--
-- Name: atelier_guardhouse_controls atelier_guardhouse_controls_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_guardhouse_controls
    ADD CONSTRAINT atelier_guardhouse_controls_pkey PRIMARY KEY (id);


--
-- Name: atelier_guardhouse_dsars atelier_guardhouse_dsars_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_guardhouse_dsars
    ADD CONSTRAINT atelier_guardhouse_dsars_pkey PRIMARY KEY (id);


--
-- Name: atelier_guardhouse_evidence atelier_guardhouse_evidence_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_guardhouse_evidence
    ADD CONSTRAINT atelier_guardhouse_evidence_pkey PRIMARY KEY (id);


--
-- Name: atelier_guardhouse_incidents atelier_guardhouse_incidents_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_guardhouse_incidents
    ADD CONSTRAINT atelier_guardhouse_incidents_pkey PRIMARY KEY (id);


--
-- Name: atelier_guardhouse_pentests atelier_guardhouse_pentests_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_guardhouse_pentests
    ADD CONSTRAINT atelier_guardhouse_pentests_pkey PRIMARY KEY (id);


--
-- Name: atelier_guardhouse_vendors atelier_guardhouse_vendors_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_guardhouse_vendors
    ADD CONSTRAINT atelier_guardhouse_vendors_pkey PRIMARY KEY (id);


--
-- Name: atelier_hypothesis_trees atelier_hypothesis_trees_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_hypothesis_trees
    ADD CONSTRAINT atelier_hypothesis_trees_pkey PRIMARY KEY (id);


--
-- Name: atelier_industries atelier_industries_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_industries
    ADD CONSTRAINT atelier_industries_pkey PRIMARY KEY (code);


--
-- Name: atelier_insurance_certificate atelier_insurance_certificate_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_insurance_certificate
    ADD CONSTRAINT atelier_insurance_certificate_pkey PRIMARY KEY (id);


--
-- Name: atelier_invitations atelier_invitations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_invitations
    ADD CONSTRAINT atelier_invitations_pkey PRIMARY KEY (id);


--
-- Name: atelier_invoice_line_drafts atelier_invoice_line_drafts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_invoice_line_drafts
    ADD CONSTRAINT atelier_invoice_line_drafts_pkey PRIMARY KEY (id);


--
-- Name: atelier_invoice_line atelier_invoice_line_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_invoice_line
    ADD CONSTRAINT atelier_invoice_line_pkey PRIMARY KEY (id);


--
-- Name: atelier_invoice atelier_invoice_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_invoice
    ADD CONSTRAINT atelier_invoice_pkey PRIMARY KEY (id);


--
-- Name: atelier_ip_code_assets atelier_ip_code_assets_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_ip_code_assets
    ADD CONSTRAINT atelier_ip_code_assets_pkey PRIMARY KEY (id);


--
-- Name: atelier_ip_demo_environments atelier_ip_demo_environments_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_ip_demo_environments
    ADD CONSTRAINT atelier_ip_demo_environments_pkey PRIMARY KEY (id);


--
-- Name: atelier_ip_license_grants atelier_ip_license_grants_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_ip_license_grants
    ADD CONSTRAINT atelier_ip_license_grants_pkey PRIMARY KEY (id);


--
-- Name: atelier_ip_oss_dependencies atelier_ip_oss_dependencies_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_ip_oss_dependencies
    ADD CONSTRAINT atelier_ip_oss_dependencies_pkey PRIMARY KEY (id);


--
-- Name: atelier_leave_entitlements atelier_leave_entitlements_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_leave_entitlements
    ADD CONSTRAINT atelier_leave_entitlements_pkey PRIMARY KEY (id);


--
-- Name: atelier_leave_requests atelier_leave_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_leave_requests
    ADD CONSTRAINT atelier_leave_requests_pkey PRIMARY KEY (id);


--
-- Name: atelier_leave_type_entitlements atelier_leave_type_entitlements_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_leave_type_entitlements
    ADD CONSTRAINT atelier_leave_type_entitlements_pkey PRIMARY KEY (id);


--
-- Name: atelier_margin_policies atelier_margin_policies_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_margin_policies
    ADD CONSTRAINT atelier_margin_policies_pkey PRIMARY KEY (id);


--
-- Name: atelier_meetings atelier_meetings_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_meetings
    ADD CONSTRAINT atelier_meetings_pkey PRIMARY KEY (id);


--
-- Name: atelier_notifications atelier_notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_notifications
    ADD CONSTRAINT atelier_notifications_pkey PRIMARY KEY (id);


--
-- Name: atelier_offboarding_steps atelier_offboarding_steps_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_offboarding_steps
    ADD CONSTRAINT atelier_offboarding_steps_pkey PRIMARY KEY (id);


--
-- Name: atelier_offboardings atelier_offboardings_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_offboardings
    ADD CONSTRAINT atelier_offboardings_pkey PRIMARY KEY (id);


--
-- Name: atelier_onboarding_steps atelier_onboarding_steps_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_onboarding_steps
    ADD CONSTRAINT atelier_onboarding_steps_pkey PRIMARY KEY (id);


--
-- Name: atelier_onboardings atelier_onboardings_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_onboardings
    ADD CONSTRAINT atelier_onboardings_pkey PRIMARY KEY (id);


--
-- Name: atelier_opportunities atelier_opportunities_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_opportunities
    ADD CONSTRAINT atelier_opportunities_pkey PRIMARY KEY (id);


--
-- Name: atelier_opportunity_stage_transitions atelier_opportunity_stage_transitions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_opportunity_stage_transitions
    ADD CONSTRAINT atelier_opportunity_stage_transitions_pkey PRIMARY KEY (id);


--
-- Name: atelier_pane_a_items atelier_pane_a_items_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_pane_a_items
    ADD CONSTRAINT atelier_pane_a_items_pkey PRIMARY KEY (id);


--
-- Name: atelier_partner_economics atelier_partner_economics_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_partner_economics
    ADD CONSTRAINT atelier_partner_economics_pkey PRIMARY KEY (id);


--
-- Name: atelier_partner_firm_hours atelier_partner_firm_hours_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_partner_firm_hours
    ADD CONSTRAINT atelier_partner_firm_hours_pkey PRIMARY KEY (id);


--
-- Name: atelier_partner_firm_invoices atelier_partner_firm_invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_partner_firm_invoices
    ADD CONSTRAINT atelier_partner_firm_invoices_pkey PRIMARY KEY (id);


--
-- Name: atelier_partner_firm_resources atelier_partner_firm_resources_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_partner_firm_resources
    ADD CONSTRAINT atelier_partner_firm_resources_pkey PRIMARY KEY (id);


--
-- Name: atelier_partner_firms atelier_partner_firms_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_partner_firms
    ADD CONSTRAINT atelier_partner_firms_pkey PRIMARY KEY (id);


--
-- Name: atelier_pay_documents atelier_pay_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_pay_documents
    ADD CONSTRAINT atelier_pay_documents_pkey PRIMARY KEY (id);


--
-- Name: atelier_performance_goals atelier_performance_goals_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_performance_goals
    ADD CONSTRAINT atelier_performance_goals_pkey PRIMARY KEY (id);


--
-- Name: atelier_performance_reviews atelier_performance_reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_performance_reviews
    ADD CONSTRAINT atelier_performance_reviews_pkey PRIMARY KEY (id);


--
-- Name: atelier_period_close_lock atelier_period_close_lock_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_period_close_lock
    ADD CONSTRAINT atelier_period_close_lock_pkey PRIMARY KEY (id);


--
-- Name: atelier_person_documents atelier_person_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_person_documents
    ADD CONSTRAINT atelier_person_documents_pkey PRIMARY KEY (id);


--
-- Name: atelier_person_insurance atelier_person_insurance_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_person_insurance
    ADD CONSTRAINT atelier_person_insurance_pkey PRIMARY KEY (id);


--
-- Name: atelier_person_skills atelier_person_skills_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_person_skills
    ADD CONSTRAINT atelier_person_skills_pkey PRIMARY KEY (id);


--
-- Name: atelier_pov_versions atelier_pov_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_pov_versions
    ADD CONSTRAINT atelier_pov_versions_pkey PRIMARY KEY (id);


--
-- Name: atelier_povs atelier_povs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_povs
    ADD CONSTRAINT atelier_povs_pkey PRIMARY KEY (id);


--
-- Name: atelier_press_editorial_calendar atelier_press_editorial_calendar_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_press_editorial_calendar
    ADD CONSTRAINT atelier_press_editorial_calendar_pkey PRIMARY KEY (id);


--
-- Name: atelier_press_in_flight_content atelier_press_in_flight_content_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_press_in_flight_content
    ADD CONSTRAINT atelier_press_in_flight_content_pkey PRIMARY KEY (id);


--
-- Name: atelier_press_mentions atelier_press_mentions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_press_mentions
    ADD CONSTRAINT atelier_press_mentions_pkey PRIMARY KEY (id);


--
-- Name: atelier_press_newsletter atelier_press_newsletter_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_press_newsletter
    ADD CONSTRAINT atelier_press_newsletter_pkey PRIMARY KEY (id);


--
-- Name: atelier_press_partner_cadence atelier_press_partner_cadence_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_press_partner_cadence
    ADD CONSTRAINT atelier_press_partner_cadence_pkey PRIMARY KEY (id);


--
-- Name: atelier_press_speaking_opportunities atelier_press_speaking_opportunities_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_press_speaking_opportunities
    ADD CONSTRAINT atelier_press_speaking_opportunities_pkey PRIMARY KEY (id);


--
-- Name: atelier_principle_override atelier_principle_override_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_principle_override
    ADD CONSTRAINT atelier_principle_override_pkey PRIMARY KEY (id);


--
-- Name: atelier_processes atelier_processes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_processes
    ADD CONSTRAINT atelier_processes_pkey PRIMARY KEY (id);


--
-- Name: atelier_promise_to_pay atelier_promise_to_pay_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_promise_to_pay
    ADD CONSTRAINT atelier_promise_to_pay_pkey PRIMARY KEY (id);


--
-- Name: atelier_prompts atelier_prompts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_prompts
    ADD CONSTRAINT atelier_prompts_pkey PRIMARY KEY (id);


--
-- Name: atelier_proposal_recipients atelier_proposal_recipients_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_proposal_recipients
    ADD CONSTRAINT atelier_proposal_recipients_pkey PRIMARY KEY (id);


--
-- Name: atelier_proposal_sections atelier_proposal_sections_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_proposal_sections
    ADD CONSTRAINT atelier_proposal_sections_pkey PRIMARY KEY (id);


--
-- Name: atelier_proposals atelier_proposals_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_proposals
    ADD CONSTRAINT atelier_proposals_pkey PRIMARY KEY (id);


--
-- Name: atelier_prototypes atelier_prototypes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_prototypes
    ADD CONSTRAINT atelier_prototypes_pkey PRIMARY KEY (id);


--
-- Name: atelier_raid_items atelier_raid_items_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_raid_items
    ADD CONSTRAINT atelier_raid_items_pkey PRIMARY KEY (id);


--
-- Name: atelier_rate_card_rows atelier_rate_card_rows_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_rate_card_rows
    ADD CONSTRAINT atelier_rate_card_rows_pkey PRIMARY KEY (id);


--
-- Name: atelier_rate_cards atelier_rate_cards_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_rate_cards
    ADD CONSTRAINT atelier_rate_cards_pkey PRIMARY KEY (id);


--
-- Name: atelier_renewal atelier_renewal_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_renewal
    ADD CONSTRAINT atelier_renewal_pkey PRIMARY KEY (id);


--
-- Name: atelier_reports atelier_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_reports
    ADD CONSTRAINT atelier_reports_pkey PRIMARY KEY (id);


--
-- Name: atelier_research_facts atelier_research_facts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_research_facts
    ADD CONSTRAINT atelier_research_facts_pkey PRIMARY KEY (id);


--
-- Name: atelier_revenue_adjustment atelier_revenue_adjustment_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_revenue_adjustment
    ADD CONSTRAINT atelier_revenue_adjustment_pkey PRIMARY KEY (id);


--
-- Name: atelier_revenue_method atelier_revenue_method_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_revenue_method
    ADD CONSTRAINT atelier_revenue_method_pkey PRIMARY KEY (id);


--
-- Name: atelier_revenue_milestone atelier_revenue_milestone_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_revenue_milestone
    ADD CONSTRAINT atelier_revenue_milestone_pkey PRIMARY KEY (id);


--
-- Name: atelier_revenue_period_posting_line atelier_revenue_period_posting_line_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_revenue_period_posting_line
    ADD CONSTRAINT atelier_revenue_period_posting_line_pkey PRIMARY KEY (id);


--
-- Name: atelier_revenue_period_posting atelier_revenue_period_posting_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_revenue_period_posting
    ADD CONSTRAINT atelier_revenue_period_posting_pkey PRIMARY KEY (id);


--
-- Name: atelier_revenue_schedule atelier_revenue_schedule_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_revenue_schedule
    ADD CONSTRAINT atelier_revenue_schedule_pkey PRIMARY KEY (id);


--
-- Name: atelier_roster_reports_to atelier_roster_reports_to_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_roster_reports_to
    ADD CONSTRAINT atelier_roster_reports_to_pkey PRIMARY KEY (id);


--
-- Name: atelier_salon_audit_events atelier_salon_audit_events_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_salon_audit_events
    ADD CONSTRAINT atelier_salon_audit_events_pkey PRIMARY KEY (id);


--
-- Name: atelier_salon_decisions atelier_salon_decisions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_salon_decisions
    ADD CONSTRAINT atelier_salon_decisions_pkey PRIMARY KEY (id);


--
-- Name: atelier_salon_notifications atelier_salon_notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_salon_notifications
    ADD CONSTRAINT atelier_salon_notifications_pkey PRIMARY KEY (id);


--
-- Name: atelier_salon_requests atelier_salon_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_salon_requests
    ADD CONSTRAINT atelier_salon_requests_pkey PRIMARY KEY (id);


--
-- Name: atelier_salon_user_engagement_access atelier_salon_user_engagement_access_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_salon_user_engagement_access
    ADD CONSTRAINT atelier_salon_user_engagement_access_pkey PRIMARY KEY (id);


--
-- Name: atelier_salon_users atelier_salon_users_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_salon_users
    ADD CONSTRAINT atelier_salon_users_pkey PRIMARY KEY (id);


--
-- Name: atelier_salon_workspaces atelier_salon_workspaces_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_salon_workspaces
    ADD CONSTRAINT atelier_salon_workspaces_pkey PRIMARY KEY (id);


--
-- Name: atelier_self_notifications atelier_self_notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_self_notifications
    ADD CONSTRAINT atelier_self_notifications_pkey PRIMARY KEY (id);


--
-- Name: atelier_skills atelier_skills_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_skills
    ADD CONSTRAINT atelier_skills_pkey PRIMARY KEY (id);


--
-- Name: atelier_studio_candidates atelier_studio_candidates_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_studio_candidates
    ADD CONSTRAINT atelier_studio_candidates_pkey PRIMARY KEY (id);


--
-- Name: atelier_studio_interview_panels atelier_studio_interview_panels_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_studio_interview_panels
    ADD CONSTRAINT atelier_studio_interview_panels_pkey PRIMARY KEY (id);


--
-- Name: atelier_studio_offers atelier_studio_offers_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_studio_offers
    ADD CONSTRAINT atelier_studio_offers_pkey PRIMARY KEY (id);


--
-- Name: atelier_studio_open_roles atelier_studio_open_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_studio_open_roles
    ADD CONSTRAINT atelier_studio_open_roles_pkey PRIMARY KEY (id);


--
-- Name: atelier_studio_reference_checks atelier_studio_reference_checks_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_studio_reference_checks
    ADD CONSTRAINT atelier_studio_reference_checks_pkey PRIMARY KEY (id);


--
-- Name: atelier_studio_referrals atelier_studio_referrals_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_studio_referrals
    ADD CONSTRAINT atelier_studio_referrals_pkey PRIMARY KEY (id);


--
-- Name: atelier_sub_industries atelier_sub_industries_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_sub_industries
    ADD CONSTRAINT atelier_sub_industries_pkey PRIMARY KEY (code);


--
-- Name: atelier_timesheet_entries atelier_timesheet_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_timesheet_entries
    ADD CONSTRAINT atelier_timesheet_entries_pkey PRIMARY KEY (id);


--
-- Name: atelier_timesheet_signals atelier_timesheet_signals_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_timesheet_signals
    ADD CONSTRAINT atelier_timesheet_signals_pkey PRIMARY KEY (id);


--
-- Name: atelier_timesheet_weeks atelier_timesheet_weeks_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_timesheet_weeks
    ADD CONSTRAINT atelier_timesheet_weeks_pkey PRIMARY KEY (id);


--
-- Name: atelier_training_completions atelier_training_completions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_training_completions
    ADD CONSTRAINT atelier_training_completions_pkey PRIMARY KEY (id);


--
-- Name: atelier_training_materials atelier_training_materials_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_training_materials
    ADD CONSTRAINT atelier_training_materials_pkey PRIMARY KEY (id);


--
-- Name: atelier_transcripts atelier_transcripts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_transcripts
    ADD CONSTRAINT atelier_transcripts_pkey PRIMARY KEY (id);


--
-- Name: atelier_two_partner_countersign atelier_two_partner_countersign_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_two_partner_countersign
    ADD CONSTRAINT atelier_two_partner_countersign_pkey PRIMARY KEY (id);


--
-- Name: atelier_unbilled_wip_snapshot atelier_unbilled_wip_snapshot_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_unbilled_wip_snapshot
    ADD CONSTRAINT atelier_unbilled_wip_snapshot_pkey PRIMARY KEY (id);


--
-- Name: atelier_users atelier_users_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_users
    ADD CONSTRAINT atelier_users_pkey PRIMARY KEY (id);


--
-- Name: atelier_utilization_snapshots atelier_utilization_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_utilization_snapshots
    ADD CONSTRAINT atelier_utilization_snapshots_pkey PRIMARY KEY (id);


--
-- Name: atelier_vat_register atelier_vat_register_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_vat_register
    ADD CONSTRAINT atelier_vat_register_pkey PRIMARY KEY (id);


--
-- Name: atelier_win_themes atelier_win_themes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_win_themes
    ADD CONSTRAINT atelier_win_themes_pkey PRIMARY KEY (id);


--
-- Name: atelier_winloss_debriefs atelier_winloss_debriefs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_winloss_debriefs
    ADD CONSTRAINT atelier_winloss_debriefs_pkey PRIMARY KEY (id);


--
-- Name: atelier_wip_snapshot_run_log atelier_wip_snapshot_run_log_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_wip_snapshot_run_log
    ADD CONSTRAINT atelier_wip_snapshot_run_log_pkey PRIMARY KEY (id);


--
-- Name: call_requests call_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.call_requests
    ADD CONSTRAINT call_requests_pkey PRIMARY KEY (id);


--
-- Name: tasama_agent_performance tasama_agent_performance_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tasama_agent_performance
    ADD CONSTRAINT tasama_agent_performance_pkey PRIMARY KEY (id);


--
-- Name: tasama_clients tasama_clients_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tasama_clients
    ADD CONSTRAINT tasama_clients_pkey PRIMARY KEY (id);


--
-- Name: tasama_documents tasama_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tasama_documents
    ADD CONSTRAINT tasama_documents_pkey PRIMARY KEY (id);


--
-- Name: tasama_employees tasama_employees_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tasama_employees
    ADD CONSTRAINT tasama_employees_pkey PRIMARY KEY (id);


--
-- Name: tasama_eosb_provisions tasama_eosb_provisions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tasama_eosb_provisions
    ADD CONSTRAINT tasama_eosb_provisions_pkey PRIMARY KEY (id);


--
-- Name: tasama_gosi_records tasama_gosi_records_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tasama_gosi_records
    ADD CONSTRAINT tasama_gosi_records_pkey PRIMARY KEY (id);


--
-- Name: tasama_leave_balances tasama_leave_balances_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tasama_leave_balances
    ADD CONSTRAINT tasama_leave_balances_pkey PRIMARY KEY (id);


--
-- Name: tasama_payroll_runs tasama_payroll_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tasama_payroll_runs
    ADD CONSTRAINT tasama_payroll_runs_pkey PRIMARY KEY (id);


--
-- Name: tasama_payslips tasama_payslips_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tasama_payslips
    ADD CONSTRAINT tasama_payslips_pkey PRIMARY KEY (id);


--
-- Name: tasama_regulatory_calendar tasama_regulatory_calendar_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tasama_regulatory_calendar
    ADD CONSTRAINT tasama_regulatory_calendar_pkey PRIMARY KEY (id);


--
-- Name: tasama_salary_components tasama_salary_components_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tasama_salary_components
    ADD CONSTRAINT tasama_salary_components_pkey PRIMARY KEY (id);


--
-- Name: tasama_service_requests tasama_service_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tasama_service_requests
    ADD CONSTRAINT tasama_service_requests_pkey PRIMARY KEY (id);


--
-- Name: team_invitations team_invitations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.team_invitations
    ADD CONSTRAINT team_invitations_pkey PRIMARY KEY (id);


--
-- Name: team_invitations team_invitations_team_token_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.team_invitations
    ADD CONSTRAINT team_invitations_team_token_unique UNIQUE (team_token);


--
-- Name: idx_arcelik_cp_brand; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_arcelik_cp_brand ON public.arcelik_competitor_prices USING btree (brand);


--
-- Name: idx_arcelik_cp_category; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_arcelik_cp_category ON public.arcelik_competitor_prices USING btree (category);


--
-- Name: idx_arcelik_dealers_city; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_arcelik_dealers_city ON public.arcelik_dealers USING btree (city);


--
-- Name: idx_arcelik_products_category; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_arcelik_products_category ON public.arcelik_products USING btree (category);


--
-- Name: idx_arcelik_products_price_tier; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_arcelik_products_price_tier ON public.arcelik_products USING btree (price_tier);


--
-- Name: idx_assessment_slug; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_assessment_slug ON public.assessment_submissions USING btree (slug);


--
-- Name: idx_assessment_team_token; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_assessment_team_token ON public.assessment_submissions USING btree (team_token);


--
-- Name: idx_atelier_account_actions_account; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_account_actions_account ON public.atelier_account_actions USING btree (account_id);


--
-- Name: idx_atelier_account_actions_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_account_actions_org ON public.atelier_account_actions USING btree (org_id);


--
-- Name: idx_atelier_account_actions_owner; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_account_actions_owner ON public.atelier_account_actions USING btree (owner_id);


--
-- Name: idx_atelier_account_goal_progress_account; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_account_goal_progress_account ON public.atelier_account_goal_progress USING btree (account_id);


--
-- Name: idx_atelier_account_goal_progress_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_account_goal_progress_org ON public.atelier_account_goal_progress USING btree (org_id);


--
-- Name: idx_atelier_account_insights_account; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_account_insights_account ON public.atelier_account_insights USING btree (account_id);


--
-- Name: idx_atelier_account_insights_author; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_account_insights_author ON public.atelier_account_insights USING btree (author_id);


--
-- Name: idx_atelier_account_insights_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_account_insights_org ON public.atelier_account_insights USING btree (org_id);


--
-- Name: idx_atelier_account_risks_account; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_account_risks_account ON public.atelier_account_risks USING btree (account_id);


--
-- Name: idx_atelier_account_risks_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_account_risks_org ON public.atelier_account_risks USING btree (org_id);


--
-- Name: idx_atelier_account_team_account; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_account_team_account ON public.atelier_account_team_members USING btree (account_id);


--
-- Name: idx_atelier_account_team_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_account_team_org ON public.atelier_account_team_members USING btree (org_id);


--
-- Name: idx_atelier_account_team_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_account_team_user ON public.atelier_account_team_members USING btree (user_id);


--
-- Name: idx_atelier_accounts_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_accounts_org ON public.atelier_accounts USING btree (org_id);


--
-- Name: idx_atelier_accounts_partner; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_accounts_partner ON public.atelier_accounts USING btree (partner_owner_id);


--
-- Name: idx_atelier_accounts_tier; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_accounts_tier ON public.atelier_accounts USING btree (tier);


--
-- Name: idx_atelier_activities_account; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_activities_account ON public.atelier_activities USING btree (account_id);


--
-- Name: idx_atelier_activities_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_activities_org ON public.atelier_activities USING btree (org_id);


--
-- Name: idx_atelier_activities_owner; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_activities_owner ON public.atelier_activities USING btree (owner_id);


--
-- Name: idx_atelier_activities_parent; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_activities_parent ON public.atelier_activities USING btree (parent_type, parent_id);


--
-- Name: idx_atelier_activities_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_activities_status ON public.atelier_activities USING btree (status);


--
-- Name: idx_atelier_agent_deploys_env; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_agent_deploys_env ON public.atelier_agent_deployments USING btree (environment);


--
-- Name: idx_atelier_agent_deploys_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_agent_deploys_org ON public.atelier_agent_deployments USING btree (org_id);


--
-- Name: idx_atelier_agent_eval_agent; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_agent_eval_agent ON public.atelier_agent_eval_suites USING btree (agent_id);


--
-- Name: idx_atelier_agent_eval_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_agent_eval_org ON public.atelier_agent_eval_suites USING btree (org_id);


--
-- Name: idx_atelier_agent_incidents_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_agent_incidents_org ON public.atelier_agent_incidents USING btree (org_id);


--
-- Name: idx_atelier_agent_incidents_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_agent_incidents_status ON public.atelier_agent_incidents USING btree (status);


--
-- Name: idx_atelier_agent_retire_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_agent_retire_org ON public.atelier_agent_retirements USING btree (org_id);


--
-- Name: idx_atelier_agent_retire_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_agent_retire_status ON public.atelier_agent_retirements USING btree (status);


--
-- Name: idx_atelier_agent_specs_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_agent_specs_org ON public.atelier_agent_specs USING btree (org_id);


--
-- Name: idx_atelier_agent_specs_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_agent_specs_status ON public.atelier_agent_specs USING btree (status);


--
-- Name: idx_atelier_agent_versions_agent; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_agent_versions_agent ON public.atelier_agent_versions USING btree (agent_id);


--
-- Name: idx_atelier_agent_versions_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_agent_versions_org ON public.atelier_agent_versions USING btree (org_id);


--
-- Name: idx_atelier_alliance_cert_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_alliance_cert_org ON public.atelier_alliance_certifications USING btree (org_id);


--
-- Name: idx_atelier_alliance_conf_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_alliance_conf_org ON public.atelier_alliance_conflicts USING btree (org_id);


--
-- Name: idx_atelier_alliance_jp_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_alliance_jp_org ON public.atelier_alliance_joint_pipeline USING btree (org_id);


--
-- Name: idx_atelier_alliance_pf_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_alliance_pf_org ON public.atelier_alliance_partner_firms USING btree (org_id);


--
-- Name: idx_atelier_art_parent; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_art_parent ON public.atelier_artifacts USING btree (parent_type, parent_id);


--
-- Name: idx_atelier_assets_kind; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_assets_kind ON public.atelier_assets USING btree (kind);


--
-- Name: idx_atelier_assets_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_assets_org ON public.atelier_assets USING btree (org_id);


--
-- Name: idx_atelier_audit_entity; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_audit_entity ON public.atelier_audit_events USING btree (entity_type, entity_id);


--
-- Name: idx_atelier_audit_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_audit_org ON public.atelier_audit_events USING btree (org_id);


--
-- Name: idx_atelier_audit_ts; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_audit_ts ON public.atelier_audit_events USING btree (ts);


--
-- Name: idx_atelier_auth_cred_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_auth_cred_user ON public.atelier_auth_credentials USING btree (user_id);


--
-- Name: idx_atelier_auth_sessions_exp; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_auth_sessions_exp ON public.atelier_auth_sessions USING btree (expires_at);


--
-- Name: idx_atelier_auth_sessions_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_auth_sessions_user ON public.atelier_auth_sessions USING btree (user_id);


--
-- Name: idx_atelier_bank_account_active; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_bank_account_active ON public.atelier_bank_account USING btree (is_active);


--
-- Name: idx_atelier_bank_account_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_bank_account_org ON public.atelier_bank_account USING btree (org_id);


--
-- Name: idx_atelier_bank_import_acct; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_bank_import_acct ON public.atelier_bank_statement_import USING btree (bank_account_id);


--
-- Name: idx_atelier_bank_import_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_bank_import_date ON public.atelier_bank_statement_import USING btree (statement_date);


--
-- Name: idx_atelier_bank_recon_acct; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_bank_recon_acct ON public.atelier_bank_recon_period USING btree (bank_account_id);


--
-- Name: idx_atelier_bank_txn_acct; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_bank_txn_acct ON public.atelier_bank_transaction USING btree (bank_account_id);


--
-- Name: idx_atelier_bank_txn_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_bank_txn_date ON public.atelier_bank_transaction USING btree (posted_date);


--
-- Name: idx_atelier_bank_txn_state; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_bank_txn_state ON public.atelier_bank_transaction USING btree (matched_state);


--
-- Name: idx_atelier_bankreq_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_bankreq_org ON public.atelier_bank_change_requests USING btree (org_id);


--
-- Name: idx_atelier_bankreq_person; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_bankreq_person ON public.atelier_bank_change_requests USING btree (person_type, person_id);


--
-- Name: idx_atelier_bankreq_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_bankreq_status ON public.atelier_bank_change_requests USING btree (status);


--
-- Name: idx_atelier_briefs_opp; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_briefs_opp ON public.atelier_briefs USING btree (opportunity_id);


--
-- Name: idx_atelier_cal_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_cal_org ON public.atelier_calendar_events USING btree (org_id);


--
-- Name: idx_atelier_cal_person_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_cal_person_date ON public.atelier_calendar_events USING btree (person_id, starts_at);


--
-- Name: idx_atelier_cap_emb_provider; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_cap_emb_provider ON public.atelier_capability_embeddings USING btree (provider);


--
-- Name: idx_atelier_cap_emb_tool; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_cap_emb_tool ON public.atelier_capability_embeddings USING btree (tool_name);


--
-- Name: idx_atelier_cards_holder; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_cards_holder ON public.atelier_corporate_cards USING btree (cardholder_user_id);


--
-- Name: idx_atelier_cards_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_cards_org ON public.atelier_corporate_cards USING btree (org_id);


--
-- Name: idx_atelier_cash_app_invoice; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_cash_app_invoice ON public.atelier_cash_application USING btree (invoice_id);


--
-- Name: idx_atelier_cash_app_receipt; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_cash_app_receipt ON public.atelier_cash_application USING btree (cash_receipt_id);


--
-- Name: idx_atelier_cash_app_reverses; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_cash_app_reverses ON public.atelier_cash_application USING btree (reverses_application_id);


--
-- Name: idx_atelier_cash_audit_target; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_cash_audit_target ON public.atelier_cash_audit USING btree (target);


--
-- Name: idx_atelier_cash_audit_ts; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_cash_audit_ts ON public.atelier_cash_audit USING btree (ts);


--
-- Name: idx_atelier_cash_receipt_cust; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_cash_receipt_cust ON public.atelier_cash_receipt USING btree (customer_id);


--
-- Name: idx_atelier_cash_receipt_txn; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_cash_receipt_txn ON public.atelier_cash_receipt USING btree (bank_transaction_id);


--
-- Name: idx_atelier_cashfc_acct; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_cashfc_acct ON public.atelier_cash_forecast_snapshot USING btree (bank_account_id);


--
-- Name: idx_atelier_cashfc_snap; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_cashfc_snap ON public.atelier_cash_forecast_snapshot USING btree (snapshot_id);


--
-- Name: idx_atelier_cashfc_week; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_cashfc_week ON public.atelier_cash_forecast_snapshot USING btree (week_start);


--
-- Name: idx_atelier_change_order_contract; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_change_order_contract ON public.atelier_change_order USING btree (contract_id);


--
-- Name: idx_atelier_change_order_engagement; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_change_order_engagement ON public.atelier_change_order USING btree (engagement_id);


--
-- Name: idx_atelier_change_order_parent; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_change_order_parent ON public.atelier_change_order USING btree (parent_contract_id);


--
-- Name: idx_atelier_change_order_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_change_order_status ON public.atelier_change_order USING btree (status);


--
-- Name: idx_atelier_charterv_eng; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_charterv_eng ON public.atelier_charter_versions USING btree (engagement_id);


--
-- Name: idx_atelier_chunk_emb_account; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_chunk_emb_account ON public.atelier_document_chunk_embeddings USING btree (org_id, account_id);


--
-- Name: idx_atelier_chunk_emb_attachment; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_chunk_emb_attachment ON public.atelier_document_chunk_embeddings USING btree (attachment_id);


--
-- Name: idx_atelier_chunk_emb_engagement; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_chunk_emb_engagement ON public.atelier_document_chunk_embeddings USING btree (org_id, engagement_id);


--
-- Name: idx_atelier_chunk_emb_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_chunk_emb_org ON public.atelier_document_chunk_embeddings USING btree (org_id);


--
-- Name: idx_atelier_chunk_emb_provider; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_chunk_emb_provider ON public.atelier_document_chunk_embeddings USING btree (provider);


--
-- Name: idx_atelier_chunk_emb_uploader; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_chunk_emb_uploader ON public.atelier_document_chunk_embeddings USING btree (org_id, uploader_user_id);


--
-- Name: idx_atelier_clause_acc_clause; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_clause_acc_clause ON public.atelier_clause_acceptance USING btree (clause_id);


--
-- Name: idx_atelier_clause_acc_cp; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_clause_acc_cp ON public.atelier_clause_acceptance USING btree (counterparty_id);


--
-- Name: idx_atelier_clause_family; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_clause_family ON public.atelier_clause USING btree (family);


--
-- Name: idx_atelier_clause_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_clause_org ON public.atelier_clause USING btree (org_id);


--
-- Name: idx_atelier_clause_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_clause_status ON public.atelier_clause USING btree (status);


--
-- Name: idx_atelier_cli_attachments_session; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_cli_attachments_session ON public.atelier_cli_attachments USING btree (session_id);


--
-- Name: idx_atelier_cli_attachments_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_cli_attachments_status ON public.atelier_cli_attachments USING btree (status);


--
-- Name: idx_atelier_cli_attachments_turn; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_cli_attachments_turn ON public.atelier_cli_attachments USING btree (turn_id);


--
-- Name: idx_atelier_cli_attachments_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_cli_attachments_user ON public.atelier_cli_attachments USING btree (user_id);


--
-- Name: idx_atelier_cli_jobs_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_cli_jobs_status ON public.atelier_cli_jobs USING btree (status);


--
-- Name: idx_atelier_cli_jobs_turn; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_cli_jobs_turn ON public.atelier_cli_jobs USING btree (turn_id);


--
-- Name: idx_atelier_cli_sessions_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_cli_sessions_org ON public.atelier_cli_sessions USING btree (org_id);


--
-- Name: idx_atelier_cli_sessions_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_cli_sessions_user ON public.atelier_cli_sessions USING btree (user_id);


--
-- Name: idx_atelier_cli_turns_session; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_cli_turns_session ON public.atelier_cli_turns USING btree (session_id);


--
-- Name: idx_atelier_cli_turns_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_cli_turns_status ON public.atelier_cli_turns USING btree (status);


--
-- Name: idx_atelier_cli_turns_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_cli_turns_user ON public.atelier_cli_turns USING btree (user_id);


--
-- Name: idx_atelier_compliance_expiry; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_compliance_expiry ON public.atelier_compliance_records USING btree (expiry_date);


--
-- Name: idx_atelier_compliance_kind; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_compliance_kind ON public.atelier_compliance_records USING btree (kind);


--
-- Name: idx_atelier_compliance_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_compliance_org ON public.atelier_compliance_records USING btree (org_id);


--
-- Name: idx_atelier_compliance_person; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_compliance_person ON public.atelier_compliance_records USING btree (person_type, person_id);


--
-- Name: idx_atelier_conflict_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_conflict_org ON public.atelier_conflict_disclosures USING btree (org_id);


--
-- Name: idx_atelier_conflict_person; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_conflict_person ON public.atelier_conflict_disclosures USING btree (person_type, person_id);


--
-- Name: idx_atelier_contact_rels_account; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_contact_rels_account ON public.atelier_contact_relationships USING btree (account_id);


--
-- Name: idx_atelier_contact_rels_from; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_contact_rels_from ON public.atelier_contact_relationships USING btree (from_contact_id);


--
-- Name: idx_atelier_contact_rels_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_contact_rels_org ON public.atelier_contact_relationships USING btree (org_id);


--
-- Name: idx_atelier_contacts_account; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_contacts_account ON public.atelier_contacts USING btree (account_id);


--
-- Name: idx_atelier_contacts_disposition; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_contacts_disposition ON public.atelier_contacts USING btree (disposition);


--
-- Name: idx_atelier_contacts_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_contacts_org ON public.atelier_contacts USING btree (org_id);


--
-- Name: idx_atelier_contract_clause_clause; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_contract_clause_clause ON public.atelier_contract_clause USING btree (clause_id);


--
-- Name: idx_atelier_contract_clause_contract; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_contract_clause_contract ON public.atelier_contract_clause USING btree (contract_id);


--
-- Name: idx_atelier_contract_counterparty; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_contract_counterparty ON public.atelier_contract USING btree (counterparty_id);


--
-- Name: idx_atelier_contract_engagement; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_contract_engagement ON public.atelier_contract USING btree (engagement_id);


--
-- Name: idx_atelier_contract_opportunity; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_contract_opportunity ON public.atelier_contract USING btree (opportunity_id);


--
-- Name: idx_atelier_contract_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_contract_org ON public.atelier_contract USING btree (org_id);


--
-- Name: idx_atelier_contract_party_contract; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_contract_party_contract ON public.atelier_contract_party USING btree (contract_id);


--
-- Name: idx_atelier_contract_party_state; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_contract_party_state ON public.atelier_contract_party USING btree (sign_state);


--
-- Name: idx_atelier_contract_redline_contract; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_contract_redline_contract ON public.atelier_contract_redline USING btree (contract_id);


--
-- Name: idx_atelier_contract_redline_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_contract_redline_status ON public.atelier_contract_redline USING btree (status);


--
-- Name: idx_atelier_contract_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_contract_status ON public.atelier_contract USING btree (status);


--
-- Name: idx_atelier_contract_term_end; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_contract_term_end ON public.atelier_contract USING btree (term_end);


--
-- Name: idx_atelier_contract_version_contract; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_contract_version_contract ON public.atelier_contract_version USING btree (contract_id);


--
-- Name: idx_atelier_contractors_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_contractors_org ON public.atelier_contractors USING btree (org_id);


--
-- Name: idx_atelier_contractors_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_contractors_status ON public.atelier_contractors USING btree (status);


--
-- Name: idx_atelier_counterparty_account; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_counterparty_account ON public.atelier_counterparty USING btree (account_id);


--
-- Name: idx_atelier_counterparty_kind; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_counterparty_kind ON public.atelier_counterparty USING btree (kind);


--
-- Name: idx_atelier_counterparty_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_counterparty_org ON public.atelier_counterparty USING btree (org_id);


--
-- Name: idx_atelier_countries_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_countries_org ON public.atelier_countries USING btree (org_id);


--
-- Name: idx_atelier_countries_region; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_countries_region ON public.atelier_countries USING btree (region);


--
-- Name: idx_atelier_countries_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_countries_status ON public.atelier_countries USING btree (status);


--
-- Name: idx_atelier_cp_eng_week; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_cp_eng_week ON public.atelier_contractor_payments USING btree (engagement_id, week_iso);


--
-- Name: idx_atelier_cp_payee_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_cp_payee_status ON public.atelier_contractor_payments USING btree (payee_user_id, status);


--
-- Name: idx_atelier_cp_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_cp_status ON public.atelier_contractor_payments USING btree (status);


--
-- Name: idx_atelier_credentials_account; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_credentials_account ON public.atelier_credentials USING btree (account_id);


--
-- Name: idx_atelier_credentials_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_credentials_org ON public.atelier_credentials USING btree (org_id);


--
-- Name: idx_atelier_credentials_sector; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_credentials_sector ON public.atelier_credentials USING btree (sector);


--
-- Name: idx_atelier_dealpricing_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_dealpricing_status ON public.atelier_deal_pricings USING btree (margin_lock_status);


--
-- Name: idx_atelier_deliv_acc_engagement; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_deliv_acc_engagement ON public.atelier_deliverable_acceptance USING btree (engagement_id);


--
-- Name: idx_atelier_deliv_acc_milestone; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_deliv_acc_milestone ON public.atelier_deliverable_acceptance USING btree (milestone_id);


--
-- Name: idx_atelier_deliv_acc_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_deliv_acc_status ON public.atelier_deliverable_acceptance USING btree (status);


--
-- Name: idx_atelier_deliv_eng; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_deliv_eng ON public.atelier_deliverables USING btree (engagement_id);


--
-- Name: idx_atelier_deliv_publish_deliv; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_deliv_publish_deliv ON public.atelier_deliverable_publishes USING btree (deliverable_id);


--
-- Name: idx_atelier_deliv_publish_eng; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_deliv_publish_eng ON public.atelier_deliverable_publishes USING btree (engagement_id);


--
-- Name: idx_atelier_dependents_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_dependents_org ON public.atelier_dependents USING btree (org_id);


--
-- Name: idx_atelier_dependents_person; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_dependents_person ON public.atelier_dependents USING btree (person_type, person_id);


--
-- Name: idx_atelier_dpa_counterparty; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_dpa_counterparty ON public.atelier_dpa USING btree (counterparty_id);


--
-- Name: idx_atelier_dpa_engagement; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_dpa_engagement ON public.atelier_dpa USING btree (engagement_id);


--
-- Name: idx_atelier_dpa_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_dpa_status ON public.atelier_dpa USING btree (status);


--
-- Name: idx_atelier_dunning_event_invoice; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_dunning_event_invoice ON public.atelier_dunning_event USING btree (invoice_id);


--
-- Name: idx_atelier_dv_deliv; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_dv_deliv ON public.atelier_deliverable_versions USING btree (deliverable_id);


--
-- Name: idx_atelier_einvoice_invoice; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_einvoice_invoice ON public.atelier_einvoice_submission USING btree (invoice_id);


--
-- Name: idx_atelier_einvoice_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_einvoice_status ON public.atelier_einvoice_submission USING btree (status);


--
-- Name: idx_atelier_emergency_contacts_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_emergency_contacts_org ON public.atelier_emergency_contacts USING btree (org_id);


--
-- Name: idx_atelier_emergency_contacts_person; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_emergency_contacts_person ON public.atelier_emergency_contacts USING btree (person_type, person_id);


--
-- Name: idx_atelier_employees_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_employees_org ON public.atelier_employees USING btree (org_id);


--
-- Name: idx_atelier_employees_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_employees_status ON public.atelier_employees USING btree (status);


--
-- Name: idx_atelier_employees_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_employees_user ON public.atelier_employees USING btree (user_id);


--
-- Name: idx_atelier_eng_access_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_eng_access_status ON public.atelier_engagement_access USING btree (status);


--
-- Name: idx_atelier_eng_access_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_eng_access_user ON public.atelier_engagement_access USING btree (user_id);


--
-- Name: idx_atelier_eng_account; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_eng_account ON public.atelier_engagements USING btree (account_id);


--
-- Name: idx_atelier_eng_budget_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_eng_budget_org ON public.atelier_engagement_budget USING btree (org_id);


--
-- Name: idx_atelier_eng_ctd_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_eng_ctd_org ON public.atelier_engagement_cost_to_date USING btree (org_id);


--
-- Name: idx_atelier_eng_etc_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_eng_etc_org ON public.atelier_engagement_etc USING btree (org_id);


--
-- Name: idx_atelier_eng_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_eng_org ON public.atelier_engagements USING btree (org_id);


--
-- Name: idx_atelier_eng_pnl_audit_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_eng_pnl_audit_at ON public.atelier_engagement_pnl_audit USING btree (at_iso);


--
-- Name: idx_atelier_eng_pnl_audit_engagement; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_eng_pnl_audit_engagement ON public.atelier_engagement_pnl_audit USING btree (engagement_id);


--
-- Name: idx_atelier_eng_pnl_co_engagement; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_eng_pnl_co_engagement ON public.atelier_engagement_pnl_change_order USING btree (engagement_id);


--
-- Name: idx_atelier_eng_pnl_co_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_eng_pnl_co_status ON public.atelier_engagement_pnl_change_order USING btree (status);


--
-- Name: idx_atelier_ent_emb_org_kind; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_ent_emb_org_kind ON public.atelier_entity_embeddings USING btree (org_id, kind);


--
-- Name: idx_atelier_expense_eng_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_expense_eng_status ON public.atelier_expenses USING btree (engagement_id, status);


--
-- Name: idx_atelier_expense_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_expense_org ON public.atelier_expenses USING btree (org_id);


--
-- Name: idx_atelier_expense_person_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_expense_person_date ON public.atelier_expenses USING btree (person_id, expense_date);


--
-- Name: idx_atelier_expense_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_expense_status ON public.atelier_expenses USING btree (status);


--
-- Name: idx_atelier_extracted_kind; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_extracted_kind ON public.atelier_extracted_documents USING btree (kind);


--
-- Name: idx_atelier_facts_opp; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_facts_opp ON public.atelier_research_facts USING btree (opportunity_id);


--
-- Name: idx_atelier_finance_plan_commits_committed_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_finance_plan_commits_committed_at ON public.atelier_finance_plan_commits USING btree (committed_at);


--
-- Name: idx_atelier_firm_profile_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_firm_profile_status ON public.atelier_firm_profile USING btree (status);


--
-- Name: idx_atelier_fx_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_fx_date ON public.atelier_fx_rates USING btree (date);


--
-- Name: idx_atelier_gh_backups_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_gh_backups_org ON public.atelier_guardhouse_backups USING btree (org_id);


--
-- Name: idx_atelier_gh_controls_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_gh_controls_org ON public.atelier_guardhouse_controls USING btree (org_id);


--
-- Name: idx_atelier_gh_controls_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_gh_controls_status ON public.atelier_guardhouse_controls USING btree (status);


--
-- Name: idx_atelier_gh_dsars_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_gh_dsars_org ON public.atelier_guardhouse_dsars USING btree (org_id);


--
-- Name: idx_atelier_gh_evidence_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_gh_evidence_org ON public.atelier_guardhouse_evidence USING btree (org_id);


--
-- Name: idx_atelier_gh_incidents_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_gh_incidents_org ON public.atelier_guardhouse_incidents USING btree (org_id);


--
-- Name: idx_atelier_gh_pentests_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_gh_pentests_org ON public.atelier_guardhouse_pentests USING btree (org_id);


--
-- Name: idx_atelier_gh_vendors_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_gh_vendors_org ON public.atelier_guardhouse_vendors USING btree (org_id);


--
-- Name: idx_atelier_ild_eng; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_ild_eng ON public.atelier_invoice_line_drafts USING btree (engagement_id);


--
-- Name: idx_atelier_ild_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_ild_status ON public.atelier_invoice_line_drafts USING btree (status);


--
-- Name: idx_atelier_industries_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_industries_org ON public.atelier_industries USING btree (org_id);


--
-- Name: idx_atelier_industries_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_industries_status ON public.atelier_industries USING btree (status);


--
-- Name: idx_atelier_insurance_counterparty; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_insurance_counterparty ON public.atelier_insurance_certificate USING btree (counterparty_id);


--
-- Name: idx_atelier_insurance_kind; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_insurance_kind ON public.atelier_insurance_certificate USING btree (kind);


--
-- Name: idx_atelier_invitations_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_invitations_org ON public.atelier_invitations USING btree (org_id);


--
-- Name: idx_atelier_invitations_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_invitations_status ON public.atelier_invitations USING btree (status);


--
-- Name: idx_atelier_invoice_acct; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_invoice_acct ON public.atelier_invoice USING btree (account_id);


--
-- Name: idx_atelier_invoice_eng; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_invoice_eng ON public.atelier_invoice USING btree (engagement_id);


--
-- Name: idx_atelier_invoice_line_invoice; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_invoice_line_invoice ON public.atelier_invoice_line USING btree (invoice_id);


--
-- Name: idx_atelier_invoice_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_invoice_status ON public.atelier_invoice USING btree (status);


--
-- Name: idx_atelier_ip_code_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_ip_code_org ON public.atelier_ip_code_assets USING btree (org_id);


--
-- Name: idx_atelier_ip_demos_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_ip_demos_org ON public.atelier_ip_demo_environments USING btree (org_id);


--
-- Name: idx_atelier_ip_grants_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_ip_grants_org ON public.atelier_ip_license_grants USING btree (org_id);


--
-- Name: idx_atelier_ip_oss_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_ip_oss_org ON public.atelier_ip_oss_dependencies USING btree (org_id);


--
-- Name: idx_atelier_leave_ent_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_leave_ent_org ON public.atelier_leave_entitlements USING btree (org_id);


--
-- Name: idx_atelier_leave_req_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_leave_req_org ON public.atelier_leave_requests USING btree (org_id);


--
-- Name: idx_atelier_leave_req_person; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_leave_req_person ON public.atelier_leave_requests USING btree (person_id, start_date);


--
-- Name: idx_atelier_leave_req_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_leave_req_status ON public.atelier_leave_requests USING btree (status);


--
-- Name: idx_atelier_leave_req_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_leave_req_user ON public.atelier_leave_requests USING btree (user_id);


--
-- Name: idx_atelier_marginsnap_eng; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_marginsnap_eng ON public.atelier_engagement_margin_snapshot USING btree (engagement_id);


--
-- Name: idx_atelier_marginsnap_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_marginsnap_org ON public.atelier_engagement_margin_snapshot USING btree (org_id);


--
-- Name: idx_atelier_marginsnap_period; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_marginsnap_period ON public.atelier_engagement_margin_snapshot USING btree (period_label);


--
-- Name: idx_atelier_mtg_parent; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_mtg_parent ON public.atelier_meetings USING btree (parent_type, parent_id);


--
-- Name: idx_atelier_notif_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_notif_org ON public.atelier_notifications USING btree (org_id);


--
-- Name: idx_atelier_notif_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_notif_user ON public.atelier_notifications USING btree (user_id);


--
-- Name: idx_atelier_notifs_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_notifs_status ON public.atelier_notifications USING btree (status);


--
-- Name: idx_atelier_offb_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_offb_org ON public.atelier_offboardings USING btree (org_id);


--
-- Name: idx_atelier_offb_person; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_offb_person ON public.atelier_offboardings USING btree (person_type, person_id);


--
-- Name: idx_atelier_offb_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_offb_status ON public.atelier_offboardings USING btree (status);


--
-- Name: idx_atelier_offb_steps_offb; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_offb_steps_offb ON public.atelier_offboarding_steps USING btree (offboarding_id);


--
-- Name: idx_atelier_offb_steps_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_offb_steps_org ON public.atelier_offboarding_steps USING btree (org_id);


--
-- Name: idx_atelier_offb_steps_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_offb_steps_status ON public.atelier_offboarding_steps USING btree (status);


--
-- Name: idx_atelier_onb_steps_onb; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_onb_steps_onb ON public.atelier_onboarding_steps USING btree (onboarding_id);


--
-- Name: idx_atelier_onb_steps_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_onb_steps_org ON public.atelier_onboarding_steps USING btree (org_id);


--
-- Name: idx_atelier_onb_steps_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_onb_steps_status ON public.atelier_onboarding_steps USING btree (status);


--
-- Name: idx_atelier_onboardings_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_onboardings_org ON public.atelier_onboardings USING btree (org_id);


--
-- Name: idx_atelier_onboardings_person; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_onboardings_person ON public.atelier_onboardings USING btree (person_type, person_id);


--
-- Name: idx_atelier_onboardings_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_onboardings_status ON public.atelier_onboardings USING btree (status);


--
-- Name: idx_atelier_opp_transitions_created; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_opp_transitions_created ON public.atelier_opportunity_stage_transitions USING btree (created_at);


--
-- Name: idx_atelier_opp_transitions_opp; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_opp_transitions_opp ON public.atelier_opportunity_stage_transitions USING btree (opportunity_id);


--
-- Name: idx_atelier_opps_account; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_opps_account ON public.atelier_opportunities USING btree (account_id);


--
-- Name: idx_atelier_opps_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_opps_org ON public.atelier_opportunities USING btree (org_id);


--
-- Name: idx_atelier_opps_sales_stage; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_opps_sales_stage ON public.atelier_opportunities USING btree (sales_stage);


--
-- Name: idx_atelier_p2p_invoice; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_p2p_invoice ON public.atelier_promise_to_pay USING btree (invoice_id);


--
-- Name: idx_atelier_panea_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_panea_org ON public.atelier_pane_a_items USING btree (org_id);


--
-- Name: idx_atelier_panea_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_panea_user ON public.atelier_pane_a_items USING btree (user_id);


--
-- Name: idx_atelier_partner_econ_emp; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_partner_econ_emp ON public.atelier_partner_economics USING btree (employee_id);


--
-- Name: idx_atelier_partner_econ_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_partner_econ_org ON public.atelier_partner_economics USING btree (org_id);


--
-- Name: idx_atelier_partner_firm_res_firm; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_partner_firm_res_firm ON public.atelier_partner_firm_resources USING btree (partner_firm_id);


--
-- Name: idx_atelier_partner_firm_res_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_partner_firm_res_org ON public.atelier_partner_firm_resources USING btree (org_id);


--
-- Name: idx_atelier_partner_firms_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_partner_firms_org ON public.atelier_partner_firms USING btree (org_id);


--
-- Name: idx_atelier_pay_docs_category; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_pay_docs_category ON public.atelier_pay_documents USING btree (category);


--
-- Name: idx_atelier_pay_docs_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_pay_docs_org ON public.atelier_pay_documents USING btree (org_id);


--
-- Name: idx_atelier_pay_docs_person; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_pay_docs_person ON public.atelier_pay_documents USING btree (person_type, person_id);


--
-- Name: idx_atelier_perf_goals_emp; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_perf_goals_emp ON public.atelier_performance_goals USING btree (employee_id);


--
-- Name: idx_atelier_perf_goals_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_perf_goals_org ON public.atelier_performance_goals USING btree (org_id);


--
-- Name: idx_atelier_perf_reviews_emp; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_perf_reviews_emp ON public.atelier_performance_reviews USING btree (employee_id);


--
-- Name: idx_atelier_perf_reviews_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_perf_reviews_org ON public.atelier_performance_reviews USING btree (org_id);


--
-- Name: idx_atelier_periodlock_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_periodlock_org ON public.atelier_period_close_lock USING btree (org_id);


--
-- Name: idx_atelier_periodlock_period; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_periodlock_period ON public.atelier_period_close_lock USING btree (period_label);


--
-- Name: idx_atelier_person_docs_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_person_docs_org ON public.atelier_person_documents USING btree (org_id);


--
-- Name: idx_atelier_person_docs_person; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_person_docs_person ON public.atelier_person_documents USING btree (person_type, person_id);


--
-- Name: idx_atelier_person_ins_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_person_ins_org ON public.atelier_person_insurance USING btree (org_id);


--
-- Name: idx_atelier_person_skills_person; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_person_skills_person ON public.atelier_person_skills USING btree (person_type, person_id);


--
-- Name: idx_atelier_person_skills_skill; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_person_skills_skill ON public.atelier_person_skills USING btree (skill_id);


--
-- Name: idx_atelier_person_skills_source; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_person_skills_source ON public.atelier_person_skills USING btree (source);


--
-- Name: idx_atelier_person_skills_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_person_skills_status ON public.atelier_person_skills USING btree (status);


--
-- Name: idx_atelier_pfh_eng; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_pfh_eng ON public.atelier_partner_firm_hours USING btree (engagement_id);


--
-- Name: idx_atelier_pfh_firm; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_pfh_firm ON public.atelier_partner_firm_hours USING btree (partner_firm_id);


--
-- Name: idx_atelier_pfh_week; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_pfh_week ON public.atelier_partner_firm_hours USING btree (week_iso);


--
-- Name: idx_atelier_pfi_eng_week; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_pfi_eng_week ON public.atelier_partner_firm_invoices USING btree (engagement_id, week_iso);


--
-- Name: idx_atelier_pfi_firm_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_pfi_firm_status ON public.atelier_partner_firm_invoices USING btree (partner_firm_id, status);


--
-- Name: idx_atelier_pfi_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_pfi_status ON public.atelier_partner_firm_invoices USING btree (status);


--
-- Name: idx_atelier_policy_cat; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_policy_cat ON public.atelier_expense_policies USING btree (category);


--
-- Name: idx_atelier_povs_opp; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_povs_opp ON public.atelier_povs USING btree (opportunity_id);


--
-- Name: idx_atelier_povv_pov; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_povv_pov ON public.atelier_pov_versions USING btree (pov_id);


--
-- Name: idx_atelier_press_ec_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_press_ec_org ON public.atelier_press_editorial_calendar USING btree (org_id);


--
-- Name: idx_atelier_press_ec_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_press_ec_status ON public.atelier_press_editorial_calendar USING btree (status);


--
-- Name: idx_atelier_press_if_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_press_if_org ON public.atelier_press_in_flight_content USING btree (org_id);


--
-- Name: idx_atelier_press_nl_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_press_nl_org ON public.atelier_press_newsletter USING btree (org_id);


--
-- Name: idx_atelier_press_pc_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_press_pc_org ON public.atelier_press_partner_cadence USING btree (org_id);


--
-- Name: idx_atelier_press_pm_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_press_pm_org ON public.atelier_press_mentions USING btree (org_id);


--
-- Name: idx_atelier_press_sp_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_press_sp_org ON public.atelier_press_speaking_opportunities USING btree (org_id);


--
-- Name: idx_atelier_principle_override_actor; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_principle_override_actor ON public.atelier_principle_override USING btree (actor_user_id);


--
-- Name: idx_atelier_principle_override_granted; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_principle_override_granted ON public.atelier_principle_override USING btree (granted_at);


--
-- Name: idx_atelier_principle_override_target; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_principle_override_target ON public.atelier_principle_override USING btree (target_table, target_id);


--
-- Name: idx_atelier_prompts_agent; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_prompts_agent ON public.atelier_prompts USING btree (agent_id);


--
-- Name: idx_atelier_proposal_recipients_proposal; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_proposal_recipients_proposal ON public.atelier_proposal_recipients USING btree (proposal_id);


--
-- Name: idx_atelier_proposals_opp; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_proposals_opp ON public.atelier_proposals USING btree (opportunity_id);


--
-- Name: idx_atelier_propsec_proposal; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_propsec_proposal ON public.atelier_proposal_sections USING btree (proposal_id);


--
-- Name: idx_atelier_proto_eng; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_proto_eng ON public.atelier_prototypes USING btree (engagement_id);


--
-- Name: idx_atelier_proto_opp; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_proto_opp ON public.atelier_prototypes USING btree (opportunity_id);


--
-- Name: idx_atelier_raid_eng; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_raid_eng ON public.atelier_raid_items USING btree (engagement_id);


--
-- Name: idx_atelier_rcrows_card; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_rcrows_card ON public.atelier_rate_card_rows USING btree (rate_card_id);


--
-- Name: idx_atelier_renewal_acct; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_renewal_acct ON public.atelier_renewal USING btree (account_id);


--
-- Name: idx_atelier_renewal_contract; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_renewal_contract ON public.atelier_renewal USING btree (contract_id);


--
-- Name: idx_atelier_renewal_due; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_renewal_due ON public.atelier_renewal USING btree (renewal_due_at);


--
-- Name: idx_atelier_renewal_engagement; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_renewal_engagement ON public.atelier_renewal USING btree (engagement_id);


--
-- Name: idx_atelier_renewal_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_renewal_status ON public.atelier_renewal USING btree (status);


--
-- Name: idx_atelier_reports_owner; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_reports_owner ON public.atelier_reports USING btree (owner_user_id);


--
-- Name: idx_atelier_reports_template; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_reports_template ON public.atelier_reports USING btree (template_id);


--
-- Name: idx_atelier_revadj_eng; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_revadj_eng ON public.atelier_revenue_adjustment USING btree (engagement_id);


--
-- Name: idx_atelier_revadj_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_revadj_org ON public.atelier_revenue_adjustment USING btree (org_id);


--
-- Name: idx_atelier_revadj_posting; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_revadj_posting ON public.atelier_revenue_adjustment USING btree (posting_id);


--
-- Name: idx_atelier_revmethod_eng; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_revmethod_eng ON public.atelier_revenue_method USING btree (engagement_id);


--
-- Name: idx_atelier_revmethod_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_revmethod_org ON public.atelier_revenue_method USING btree (org_id);


--
-- Name: idx_atelier_revmilestone_acceptance; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_revmilestone_acceptance ON public.atelier_revenue_milestone USING btree (deliverable_acceptance_id);


--
-- Name: idx_atelier_revmilestone_eng; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_revmilestone_eng ON public.atelier_revenue_milestone USING btree (engagement_id);


--
-- Name: idx_atelier_revmilestone_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_revmilestone_org ON public.atelier_revenue_milestone USING btree (org_id);


--
-- Name: idx_atelier_revmilestone_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_revmilestone_status ON public.atelier_revenue_milestone USING btree (status);


--
-- Name: idx_atelier_revposting_line_eng; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_revposting_line_eng ON public.atelier_revenue_period_posting_line USING btree (engagement_id);


--
-- Name: idx_atelier_revposting_line_kind; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_revposting_line_kind ON public.atelier_revenue_period_posting_line USING btree (kind);


--
-- Name: idx_atelier_revposting_line_posting; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_revposting_line_posting ON public.atelier_revenue_period_posting_line USING btree (posting_id);


--
-- Name: idx_atelier_revposting_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_revposting_org ON public.atelier_revenue_period_posting USING btree (org_id);


--
-- Name: idx_atelier_revposting_period; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_revposting_period ON public.atelier_revenue_period_posting USING btree (period_label);


--
-- Name: idx_atelier_revschedule_eng; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_revschedule_eng ON public.atelier_revenue_schedule USING btree (engagement_id);


--
-- Name: idx_atelier_revschedule_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_revschedule_org ON public.atelier_revenue_schedule USING btree (org_id);


--
-- Name: idx_atelier_revschedule_period; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_revschedule_period ON public.atelier_revenue_schedule USING btree (period_label);


--
-- Name: idx_atelier_revschedule_posting; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_revschedule_posting ON public.atelier_revenue_schedule USING btree (posting_id);


--
-- Name: idx_atelier_roster_reports_mgr; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_roster_reports_mgr ON public.atelier_roster_reports_to USING btree (manager_person_id);


--
-- Name: idx_atelier_roster_reports_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_roster_reports_org ON public.atelier_roster_reports_to USING btree (org_id);


--
-- Name: idx_atelier_roster_reports_person; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_roster_reports_person ON public.atelier_roster_reports_to USING btree (person_id);


--
-- Name: idx_atelier_runs_agent; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_runs_agent ON public.atelier_agent_runs USING btree (agent_id);


--
-- Name: idx_atelier_runs_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_runs_status ON public.atelier_agent_runs USING btree (status);


--
-- Name: idx_atelier_salon_access_eng; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_salon_access_eng ON public.atelier_salon_user_engagement_access USING btree (engagement_id);


--
-- Name: idx_atelier_salon_audit_eng; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_salon_audit_eng ON public.atelier_salon_audit_events USING btree (engagement_id);


--
-- Name: idx_atelier_salon_audit_ts; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_salon_audit_ts ON public.atelier_salon_audit_events USING btree (ts);


--
-- Name: idx_atelier_salon_audit_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_salon_audit_user ON public.atelier_salon_audit_events USING btree (salon_user_id);


--
-- Name: idx_atelier_salon_dec_deliv; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_salon_dec_deliv ON public.atelier_salon_decisions USING btree (deliverable_id);


--
-- Name: idx_atelier_salon_dec_eng; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_salon_dec_eng ON public.atelier_salon_decisions USING btree (engagement_id);


--
-- Name: idx_atelier_salon_notif_eng; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_salon_notif_eng ON public.atelier_salon_notifications USING btree (engagement_id);


--
-- Name: idx_atelier_salon_notif_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_salon_notif_user ON public.atelier_salon_notifications USING btree (salon_user_id);


--
-- Name: idx_atelier_salon_req_eng; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_salon_req_eng ON public.atelier_salon_requests USING btree (engagement_id);


--
-- Name: idx_atelier_salon_req_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_salon_req_status ON public.atelier_salon_requests USING btree (status);


--
-- Name: idx_atelier_salon_users_account; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_salon_users_account ON public.atelier_salon_users USING btree (account_id);


--
-- Name: idx_atelier_selfnotif_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_selfnotif_org ON public.atelier_self_notifications USING btree (org_id);


--
-- Name: idx_atelier_selfnotif_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_selfnotif_user ON public.atelier_self_notifications USING btree (user_id);


--
-- Name: idx_atelier_skills_kind; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_skills_kind ON public.atelier_skills USING btree (kind);


--
-- Name: idx_atelier_skills_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_skills_org ON public.atelier_skills USING btree (org_id);


--
-- Name: idx_atelier_studio_cand_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_studio_cand_org ON public.atelier_studio_candidates USING btree (org_id);


--
-- Name: idx_atelier_studio_cand_stage; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_studio_cand_stage ON public.atelier_studio_candidates USING btree (stage);


--
-- Name: idx_atelier_studio_offers_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_studio_offers_org ON public.atelier_studio_offers USING btree (org_id);


--
-- Name: idx_atelier_studio_panels_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_studio_panels_org ON public.atelier_studio_interview_panels USING btree (org_id);


--
-- Name: idx_atelier_studio_refrals_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_studio_refrals_org ON public.atelier_studio_referrals USING btree (org_id);


--
-- Name: idx_atelier_studio_refs_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_studio_refs_org ON public.atelier_studio_reference_checks USING btree (org_id);


--
-- Name: idx_atelier_studio_roles_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_studio_roles_org ON public.atelier_studio_open_roles USING btree (org_id);


--
-- Name: idx_atelier_sub_industries_industry; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_sub_industries_industry ON public.atelier_sub_industries USING btree (industry_code);


--
-- Name: idx_atelier_sub_industries_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_sub_industries_org ON public.atelier_sub_industries USING btree (org_id);


--
-- Name: idx_atelier_sub_industries_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_sub_industries_status ON public.atelier_sub_industries USING btree (status);


--
-- Name: idx_atelier_training_done_mat; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_training_done_mat ON public.atelier_training_completions USING btree (material_id);


--
-- Name: idx_atelier_training_done_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_training_done_org ON public.atelier_training_completions USING btree (org_id);


--
-- Name: idx_atelier_training_mat_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_training_mat_org ON public.atelier_training_materials USING btree (org_id);


--
-- Name: idx_atelier_ts_entry_eng_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_ts_entry_eng_date ON public.atelier_timesheet_entries USING btree (engagement_id, work_date);


--
-- Name: idx_atelier_ts_entry_person_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_ts_entry_person_date ON public.atelier_timesheet_entries USING btree (person_id, work_date);


--
-- Name: idx_atelier_ts_entry_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_ts_entry_status ON public.atelier_timesheet_entries USING btree (status);


--
-- Name: idx_atelier_ts_entry_week; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_ts_entry_week ON public.atelier_timesheet_entries USING btree (week_id);


--
-- Name: idx_atelier_ts_signal_person_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_ts_signal_person_date ON public.atelier_timesheet_signals USING btree (person_id, work_date);


--
-- Name: idx_atelier_ts_signal_week; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_ts_signal_week ON public.atelier_timesheet_signals USING btree (week_id);


--
-- Name: idx_atelier_ts_week_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_ts_week_org ON public.atelier_timesheet_weeks USING btree (org_id);


--
-- Name: idx_atelier_ts_week_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_ts_week_status ON public.atelier_timesheet_weeks USING btree (status);


--
-- Name: idx_atelier_two_partner_countersign_state; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_two_partner_countersign_state ON public.atelier_two_partner_countersign USING btree (state);


--
-- Name: idx_atelier_users_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_users_org ON public.atelier_users USING btree (org_id);


--
-- Name: idx_atelier_users_role; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_users_role ON public.atelier_users USING btree (role);


--
-- Name: idx_atelier_utilization_snap_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_utilization_snap_org ON public.atelier_utilization_snapshots USING btree (org_id);


--
-- Name: idx_atelier_utilization_snap_week; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_utilization_snap_week ON public.atelier_utilization_snapshots USING btree (week_iso);


--
-- Name: idx_atelier_vat_country_treatment; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_vat_country_treatment ON public.atelier_vat_register USING btree (country, treatment);


--
-- Name: idx_atelier_vat_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_vat_date ON public.atelier_vat_register USING btree (expense_date);


--
-- Name: idx_atelier_vat_expense; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_vat_expense ON public.atelier_vat_register USING btree (expense_id);


--
-- Name: idx_atelier_win_themes_polarity; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_win_themes_polarity ON public.atelier_win_themes USING btree (polarity);


--
-- Name: idx_atelier_win_themes_tag; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_win_themes_tag ON public.atelier_win_themes USING btree (tag);


--
-- Name: idx_atelier_winloss_outcome; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_winloss_outcome ON public.atelier_winloss_debriefs USING btree (outcome);


--
-- Name: idx_atelier_winloss_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_winloss_status ON public.atelier_winloss_debriefs USING btree (status);


--
-- Name: idx_atelier_wip_eng; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_wip_eng ON public.atelier_unbilled_wip_snapshot USING btree (engagement_id);


--
-- Name: idx_atelier_wip_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_wip_org ON public.atelier_unbilled_wip_snapshot USING btree (org_id);


--
-- Name: idx_atelier_wip_snap; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_wip_snap ON public.atelier_unbilled_wip_snapshot USING btree (snapshot_at);


--
-- Name: idx_atelier_wiprunlog_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_wiprunlog_org ON public.atelier_wip_snapshot_run_log USING btree (org_id);


--
-- Name: idx_atelier_wiprunlog_started; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_atelier_wiprunlog_started ON public.atelier_wip_snapshot_run_log USING btree (started_at);


--
-- Name: idx_equiv_arcelik; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_equiv_arcelik ON public.arcelik_product_equivalences USING btree (arcelik_product_id);


--
-- Name: idx_equiv_brand; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_equiv_brand ON public.arcelik_product_equivalences USING btree (competitor_brand);


--
-- Name: idx_equiv_confidence; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_equiv_confidence ON public.arcelik_product_equivalences USING btree (match_confidence);


--
-- Name: idx_mp_history_arcelik_product; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_mp_history_arcelik_product ON public.arcelik_marketplace_price_history USING btree (arcelik_product_id);


--
-- Name: idx_mp_history_brand; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_mp_history_brand ON public.arcelik_marketplace_price_history USING btree (brand);


--
-- Name: idx_mp_history_marketplace; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_mp_history_marketplace ON public.arcelik_marketplace_price_history USING btree (marketplace);


--
-- Name: idx_mp_history_pid; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_mp_history_pid ON public.arcelik_marketplace_price_history USING btree (marketplace_product_id);


--
-- Name: idx_mp_history_recorded; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_mp_history_recorded ON public.arcelik_marketplace_price_history USING btree (recorded_at);


--
-- Name: idx_mp_history_run; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_mp_history_run ON public.arcelik_marketplace_price_history USING btree (scrape_run_id);


--
-- Name: idx_mp_prices_arcelik_product; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_mp_prices_arcelik_product ON public.arcelik_marketplace_prices USING btree (arcelik_product_id);


--
-- Name: idx_mp_prices_brand; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_mp_prices_brand ON public.arcelik_marketplace_prices USING btree (brand);


--
-- Name: idx_mp_prices_category; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_mp_prices_category ON public.arcelik_marketplace_prices USING btree (category);


--
-- Name: idx_mp_prices_competitor; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_mp_prices_competitor ON public.arcelik_marketplace_prices USING btree (competitor_price_id);


--
-- Name: idx_mp_prices_marketplace; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_mp_prices_marketplace ON public.arcelik_marketplace_prices USING btree (marketplace);


--
-- Name: idx_mp_prices_run; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_mp_prices_run ON public.arcelik_marketplace_prices USING btree (scrape_run_id);


--
-- Name: idx_mp_prices_scraped; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_mp_prices_scraped ON public.arcelik_marketplace_prices USING btree (scraped_at);


--
-- Name: idx_price_history_brand; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_price_history_brand ON public.arcelik_price_history USING btree (brand);


--
-- Name: idx_price_history_recorded; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_price_history_recorded ON public.arcelik_price_history USING btree (recorded_at);


--
-- Name: idx_price_history_ref; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_price_history_ref ON public.arcelik_price_history USING btree (reference_id);


--
-- Name: idx_price_history_type; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_price_history_type ON public.arcelik_price_history USING btree (record_type);


--
-- Name: idx_scrape_logs_health; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_scrape_logs_health ON public.arcelik_scrape_logs USING btree (health_status);


--
-- Name: idx_scrape_logs_started; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_scrape_logs_started ON public.arcelik_scrape_logs USING btree (started_at);


--
-- Name: idx_scrape_logs_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_scrape_logs_status ON public.arcelik_scrape_logs USING btree (status);


--
-- Name: idx_specs_mp_price; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_specs_mp_price ON public.arcelik_product_specs USING btree (marketplace_price_id);


--
-- Name: idx_tasama_cal_due; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_tasama_cal_due ON public.tasama_regulatory_calendar USING btree (due_date);


--
-- Name: idx_tasama_cal_type; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_tasama_cal_type ON public.tasama_regulatory_calendar USING btree (type);


--
-- Name: idx_tasama_docs_client; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_tasama_docs_client ON public.tasama_documents USING btree (client_id);


--
-- Name: idx_tasama_docs_emp; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_tasama_docs_emp ON public.tasama_documents USING btree (employee_id);


--
-- Name: idx_tasama_docs_type; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_tasama_docs_type ON public.tasama_documents USING btree (type);


--
-- Name: idx_tasama_emp_client; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_tasama_emp_client ON public.tasama_employees USING btree (client_id);


--
-- Name: idx_tasama_emp_dept; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_tasama_emp_dept ON public.tasama_employees USING btree (department);


--
-- Name: idx_tasama_emp_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_tasama_emp_status ON public.tasama_employees USING btree (status);


--
-- Name: idx_tasama_eosb_emp; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_tasama_eosb_emp ON public.tasama_eosb_provisions USING btree (employee_id);


--
-- Name: idx_tasama_eosb_period; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_tasama_eosb_period ON public.tasama_eosb_provisions USING btree (period_year, period_month);


--
-- Name: idx_tasama_gosi_emp; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_tasama_gosi_emp ON public.tasama_gosi_records USING btree (employee_id);


--
-- Name: idx_tasama_gosi_period; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_tasama_gosi_period ON public.tasama_gosi_records USING btree (period_year, period_month);


--
-- Name: idx_tasama_leave_emp; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_tasama_leave_emp ON public.tasama_leave_balances USING btree (employee_id);


--
-- Name: idx_tasama_payslip_client; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_tasama_payslip_client ON public.tasama_payslips USING btree (client_id);


--
-- Name: idx_tasama_payslip_emp; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_tasama_payslip_emp ON public.tasama_payslips USING btree (employee_id);


--
-- Name: idx_tasama_payslip_run; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_tasama_payslip_run ON public.tasama_payslips USING btree (run_id);


--
-- Name: idx_tasama_perf_agent; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_tasama_perf_agent ON public.tasama_agent_performance USING btree (agent_id);


--
-- Name: idx_tasama_perf_period; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_tasama_perf_period ON public.tasama_agent_performance USING btree (period_year, period_month);


--
-- Name: idx_tasama_run_client; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_tasama_run_client ON public.tasama_payroll_runs USING btree (client_id);


--
-- Name: idx_tasama_run_period; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_tasama_run_period ON public.tasama_payroll_runs USING btree (period_year, period_month);


--
-- Name: idx_tasama_salary_emp; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_tasama_salary_emp ON public.tasama_salary_components USING btree (employee_id);


--
-- Name: idx_tasama_sr_client; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_tasama_sr_client ON public.tasama_service_requests USING btree (client_id);


--
-- Name: idx_tasama_sr_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_tasama_sr_status ON public.tasama_service_requests USING btree (status);


--
-- Name: idx_team_invitations_token; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_team_invitations_token ON public.team_invitations USING btree (team_token);


--
-- Name: uniq_atelier_clause_family_version; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uniq_atelier_clause_family_version ON public.atelier_clause USING btree (org_id, family, version);


--
-- Name: uniq_atelier_contract_clause_position; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uniq_atelier_contract_clause_position ON public.atelier_contract_clause USING btree (contract_id, "position");


--
-- Name: uniq_atelier_contract_version; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uniq_atelier_contract_version ON public.atelier_contract_version USING btree (contract_id, version);


--
-- Name: uniq_atelier_counterparty_legal; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uniq_atelier_counterparty_legal ON public.atelier_counterparty USING btree (org_id, legal_name);


--
-- Name: uniq_atelier_employees_email; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uniq_atelier_employees_email ON public.atelier_employees USING btree (org_id, email);


--
-- Name: uniq_atelier_eng_access; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uniq_atelier_eng_access ON public.atelier_engagement_access USING btree (engagement_id, user_id);


--
-- Name: uniq_atelier_ent_emb_target; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uniq_atelier_ent_emb_target ON public.atelier_entity_embeddings USING btree (kind, target_id, org_id);


--
-- Name: uniq_atelier_fx_date_pair; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uniq_atelier_fx_date_pair ON public.atelier_fx_rates USING btree (date, base, quote);


--
-- Name: uniq_atelier_leave_ent; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uniq_atelier_leave_ent ON public.atelier_leave_entitlements USING btree (person_id, year);


--
-- Name: uniq_atelier_leave_type_ent; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uniq_atelier_leave_type_ent ON public.atelier_leave_type_entitlements USING btree (org_id, employment_type, year);


--
-- Name: uniq_atelier_marginsnap_period_eng; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uniq_atelier_marginsnap_period_eng ON public.atelier_engagement_margin_snapshot USING btree (org_id, period_label, engagement_id, snapshot_at);


--
-- Name: uniq_atelier_periodlock_period; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uniq_atelier_periodlock_period ON public.atelier_period_close_lock USING btree (org_id, period_label);


--
-- Name: uniq_atelier_person_ins_person; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uniq_atelier_person_ins_person ON public.atelier_person_insurance USING btree (person_type, person_id);


--
-- Name: uniq_atelier_person_skills; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uniq_atelier_person_skills ON public.atelier_person_skills USING btree (person_type, person_id, skill_id, source);


--
-- Name: uniq_atelier_revmethod_active_per_eng; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uniq_atelier_revmethod_active_per_eng ON public.atelier_revenue_method USING btree (org_id, engagement_id, active_from);


--
-- Name: uniq_atelier_revmilestone_seq; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uniq_atelier_revmilestone_seq ON public.atelier_revenue_milestone USING btree (org_id, engagement_id, sequence);


--
-- Name: uniq_atelier_revposting_period; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uniq_atelier_revposting_period ON public.atelier_revenue_period_posting USING btree (org_id, period_label);


--
-- Name: uniq_atelier_revschedule_period_eng; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uniq_atelier_revschedule_period_eng ON public.atelier_revenue_schedule USING btree (org_id, period_label, engagement_id);


--
-- Name: uniq_atelier_roster_reports_edge; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uniq_atelier_roster_reports_edge ON public.atelier_roster_reports_to USING btree (person_id, manager_person_id);


--
-- Name: uniq_atelier_skills_slug; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uniq_atelier_skills_slug ON public.atelier_skills USING btree (org_id, slug);


--
-- Name: uniq_atelier_ts_week; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uniq_atelier_ts_week ON public.atelier_timesheet_weeks USING btree (person_id, week_iso);


--
-- Name: uniq_atelier_two_partner_countersign_contract; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uniq_atelier_two_partner_countersign_contract ON public.atelier_two_partner_countersign USING btree (contract_id);


--
-- Name: uniq_atelier_utilization_snap; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uniq_atelier_utilization_snap ON public.atelier_utilization_snapshots USING btree (person_id, week_iso);


--
-- Name: uniq_mp_prices_marketplace_pid; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uniq_mp_prices_marketplace_pid ON public.arcelik_marketplace_prices USING btree (marketplace, marketplace_product_id);


--
-- Name: uniq_specs_marketplace_pid; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uniq_specs_marketplace_pid ON public.arcelik_product_specs USING btree (marketplace, marketplace_product_id);


--
-- Name: uq_atelier_bank_import_hash; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uq_atelier_bank_import_hash ON public.atelier_bank_statement_import USING btree (org_id, bank_account_id, file_hash);


--
-- Name: uq_atelier_bank_recon_period; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uq_atelier_bank_recon_period ON public.atelier_bank_recon_period USING btree (org_id, bank_account_id, period_label);


--
-- Name: uq_atelier_cash_receipt_txn; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uq_atelier_cash_receipt_txn ON public.atelier_cash_receipt USING btree (org_id, bank_transaction_id);


--
-- Name: uq_atelier_cli_jobs_idem; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uq_atelier_cli_jobs_idem ON public.atelier_cli_jobs USING btree (idempotency_key);


--
-- Name: uq_atelier_cli_turns_client_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uq_atelier_cli_turns_client_key ON public.atelier_cli_turns USING btree (session_id, client_turn_key);


--
-- Name: uq_atelier_cp_payee_eng_week; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uq_atelier_cp_payee_eng_week ON public.atelier_contractor_payments USING btree (payee_user_id, engagement_id, week_iso);


--
-- Name: uq_atelier_dealpricing_opp; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uq_atelier_dealpricing_opp ON public.atelier_deal_pricings USING btree (opportunity_id);


--
-- Name: uq_atelier_extracted_attachment; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uq_atelier_extracted_attachment ON public.atelier_extracted_documents USING btree (attachment_id);


--
-- Name: uq_atelier_firm_profile_version; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uq_atelier_firm_profile_version ON public.atelier_firm_profile USING btree (org_id, version);


--
-- Name: uq_atelier_invoice_sequence_pk; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uq_atelier_invoice_sequence_pk ON public.atelier_invoice_sequence USING btree (org_id, jurisdiction, year_part);


--
-- Name: uq_atelier_pfi_firm_eng_week; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uq_atelier_pfi_firm_eng_week ON public.atelier_partner_firm_invoices USING btree (partner_firm_id, engagement_id, week_iso);


--
-- Name: uq_atelier_proposal_recipients_token; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uq_atelier_proposal_recipients_token ON public.atelier_proposal_recipients USING btree (token);


--
-- Name: uq_atelier_propsec; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uq_atelier_propsec ON public.atelier_proposal_sections USING btree (proposal_id, section_id);


--
-- Name: uq_atelier_training_done; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uq_atelier_training_done ON public.atelier_training_completions USING btree (material_id, user_id);


--
-- Name: uq_atelier_winloss_opp; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uq_atelier_winloss_opp ON public.atelier_winloss_debriefs USING btree (opportunity_id);


--
-- Name: ux_atelier_salon_access; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX ux_atelier_salon_access ON public.atelier_salon_user_engagement_access USING btree (salon_user_id, engagement_id);


--
-- Name: ux_atelier_salon_users_email; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX ux_atelier_salon_users_email ON public.atelier_salon_users USING btree (org_id, account_id, email);


--
-- Name: ux_atelier_salon_ws_eng; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX ux_atelier_salon_ws_eng ON public.atelier_salon_workspaces USING btree (engagement_id);


--
-- Name: ux_atelier_salon_ws_slug; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX ux_atelier_salon_ws_slug ON public.atelier_salon_workspaces USING btree (org_id, slug);


--
-- Name: arcelik_marketplace_price_history arcelik_marketplace_price_history_arcelik_product_id_arcelik_pr; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.arcelik_marketplace_price_history
    ADD CONSTRAINT arcelik_marketplace_price_history_arcelik_product_id_arcelik_pr FOREIGN KEY (arcelik_product_id) REFERENCES public.arcelik_products(id) ON DELETE SET NULL;


--
-- Name: arcelik_marketplace_prices arcelik_marketplace_prices_arcelik_product_id_arcelik_products_; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.arcelik_marketplace_prices
    ADD CONSTRAINT arcelik_marketplace_prices_arcelik_product_id_arcelik_products_ FOREIGN KEY (arcelik_product_id) REFERENCES public.arcelik_products(id) ON DELETE SET NULL;


--
-- Name: arcelik_marketplace_prices arcelik_marketplace_prices_competitor_price_id_arcelik_competit; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.arcelik_marketplace_prices
    ADD CONSTRAINT arcelik_marketplace_prices_competitor_price_id_arcelik_competit FOREIGN KEY (competitor_price_id) REFERENCES public.arcelik_competitor_prices(id) ON DELETE SET NULL;


--
-- Name: arcelik_product_equivalences arcelik_product_equivalences_arcelik_product_id_arcelik_product; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.arcelik_product_equivalences
    ADD CONSTRAINT arcelik_product_equivalences_arcelik_product_id_arcelik_product FOREIGN KEY (arcelik_product_id) REFERENCES public.arcelik_products(id) ON DELETE CASCADE;


--
-- Name: arcelik_product_specs arcelik_product_specs_marketplace_price_id_arcelik_marketplace_; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.arcelik_product_specs
    ADD CONSTRAINT arcelik_product_specs_marketplace_price_id_arcelik_marketplace_ FOREIGN KEY (marketplace_price_id) REFERENCES public.arcelik_marketplace_prices(id) ON DELETE CASCADE;


--
-- Name: atelier_briefs atelier_briefs_opportunity_id_atelier_opportunities_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_briefs
    ADD CONSTRAINT atelier_briefs_opportunity_id_atelier_opportunities_id_fk FOREIGN KEY (opportunity_id) REFERENCES public.atelier_opportunities(id) ON DELETE CASCADE;


--
-- Name: atelier_deal_pricings atelier_deal_pricings_opportunity_id_atelier_opportunities_id_f; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_deal_pricings
    ADD CONSTRAINT atelier_deal_pricings_opportunity_id_atelier_opportunities_id_f FOREIGN KEY (opportunity_id) REFERENCES public.atelier_opportunities(id) ON DELETE CASCADE;


--
-- Name: atelier_engagements atelier_engagements_opportunity_id_atelier_opportunities_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_engagements
    ADD CONSTRAINT atelier_engagements_opportunity_id_atelier_opportunities_id_fk FOREIGN KEY (opportunity_id) REFERENCES public.atelier_opportunities(id) ON DELETE SET NULL;


--
-- Name: atelier_opportunity_stage_transitions atelier_opportunity_stage_transitions_opportunity_id_atelier_op; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_opportunity_stage_transitions
    ADD CONSTRAINT atelier_opportunity_stage_transitions_opportunity_id_atelier_op FOREIGN KEY (opportunity_id) REFERENCES public.atelier_opportunities(id) ON DELETE CASCADE;


--
-- Name: atelier_povs atelier_povs_opportunity_id_atelier_opportunities_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_povs
    ADD CONSTRAINT atelier_povs_opportunity_id_atelier_opportunities_id_fk FOREIGN KEY (opportunity_id) REFERENCES public.atelier_opportunities(id) ON DELETE CASCADE;


--
-- Name: atelier_proposals atelier_proposals_opportunity_id_atelier_opportunities_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_proposals
    ADD CONSTRAINT atelier_proposals_opportunity_id_atelier_opportunities_id_fk FOREIGN KEY (opportunity_id) REFERENCES public.atelier_opportunities(id) ON DELETE CASCADE;


--
-- Name: atelier_prototypes atelier_prototypes_opportunity_id_atelier_opportunities_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_prototypes
    ADD CONSTRAINT atelier_prototypes_opportunity_id_atelier_opportunities_id_fk FOREIGN KEY (opportunity_id) REFERENCES public.atelier_opportunities(id) ON DELETE SET NULL;


--
-- Name: atelier_research_facts atelier_research_facts_opportunity_id_atelier_opportunities_id_; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_research_facts
    ADD CONSTRAINT atelier_research_facts_opportunity_id_atelier_opportunities_id_ FOREIGN KEY (opportunity_id) REFERENCES public.atelier_opportunities(id) ON DELETE CASCADE;


--
-- Name: atelier_winloss_debriefs atelier_winloss_debriefs_opportunity_id_atelier_opportunities_i; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.atelier_winloss_debriefs
    ADD CONSTRAINT atelier_winloss_debriefs_opportunity_id_atelier_opportunities_i FOREIGN KEY (opportunity_id) REFERENCES public.atelier_opportunities(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict 4Naqryb23skxm6cE2nFgMqoYBXyejlpfGakuNknsC0PkILRbeCoITPZDlnFwTcM

