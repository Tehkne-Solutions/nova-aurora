BEGIN;

CREATE TABLE IF NOT EXISTS creator_activity_items (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  activity_type text NOT NULL CHECK (activity_type IN (
    'channel_follow','content_like','content_comment','dm_request','dm_message',
    'content_sale','ugc_primary_sale','ugc_resale','ugc_royalty','ad_revenue',
    'competition_prize','moderation_report_result','moderation_restricted','appeal_resolved'
  )),
  category text NOT NULL CHECK (category IN ('social','messages','economy','safety')),
  entity_type text NOT NULL CHECK (length(entity_type) BETWEEN 1 AND 80),
  entity_id uuid,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 180),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key text NOT NULL CHECK (length(dedupe_key) BETWEEN 1 AND 240),
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  UNIQUE(user_id,dedupe_key)
);

CREATE INDEX IF NOT EXISTS creator_activity_items_user_idx
  ON creator_activity_items(user_id,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS creator_activity_items_unread_idx
  ON creator_activity_items(user_id,created_at DESC,id DESC) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS creator_activity_items_category_idx
  ON creator_activity_items(user_id,category,created_at DESC);

CREATE OR REPLACE FUNCTION enqueue_creator_activity(
  p_user_id uuid,
  p_actor_user_id uuid,
  p_activity_type text,
  p_category text,
  p_entity_type text,
  p_entity_id uuid,
  p_title text,
  p_dedupe_key text,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_user_id IS NULL OR p_user_id = p_actor_user_id THEN
    RETURN;
  END IF;
  INSERT INTO creator_activity_items(
    id,user_id,actor_user_id,activity_type,category,entity_type,entity_id,title,metadata,dedupe_key
  ) VALUES(
    gen_random_uuid(),p_user_id,p_actor_user_id,p_activity_type,p_category,p_entity_type,p_entity_id,p_title,
    coalesce(p_metadata,'{}'::jsonb),p_dedupe_key
  )
  ON CONFLICT(user_id,dedupe_key) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION creator_activity_resource_owner(p_resource_type text,p_resource_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
AS $$
DECLARE owner_id uuid;
BEGIN
  CASE p_resource_type
    WHEN 'creator_content' THEN SELECT creator_user_id INTO owner_id FROM creator_content WHERE id=p_resource_id;
    WHEN 'creator_channel' THEN SELECT creator_user_id INTO owner_id FROM creator_channels WHERE id=p_resource_id;
    WHEN 'creator_comment' THEN SELECT author_user_id INTO owner_id FROM creator_content_comments WHERE id=p_resource_id;
    WHEN 'creator_message' THEN SELECT sender_user_id INTO owner_id FROM creator_dm_messages WHERE id=p_resource_id;
    WHEN 'ugc_blueprint' THEN SELECT creator_user_id INTO owner_id FROM ugc_object_blueprints WHERE id=p_resource_id;
    WHEN 'ad_campaign' THEN SELECT advertiser_user_id INTO owner_id FROM economy_ad_campaigns WHERE id=p_resource_id;
    WHEN 'ad_surface' THEN SELECT owner_user_id INTO owner_id FROM economy_ad_surfaces WHERE id=p_resource_id;
    WHEN 'competition' THEN SELECT organizer_user_id INTO owner_id FROM player_competitions WHERE id=p_resource_id;
    ELSE owner_id := NULL;
  END CASE;
  RETURN owner_id;
END;
$$;

CREATE OR REPLACE FUNCTION activity_on_creator_follow()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_user_id uuid;
BEGIN
  SELECT creator_user_id INTO target_user_id FROM creator_channels WHERE id=NEW.channel_id;
  PERFORM enqueue_creator_activity(
    target_user_id,NEW.follower_user_id,'channel_follow','social','creator_channel',NEW.channel_id,
    'Novo seguidor','follow:'||NEW.channel_id::text||':'||NEW.follower_user_id::text,
    jsonb_build_object('channelId',NEW.channel_id)
  );
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS creator_activity_follow_trigger ON creator_channel_follows;
CREATE TRIGGER creator_activity_follow_trigger AFTER INSERT ON creator_channel_follows
FOR EACH ROW EXECUTE FUNCTION activity_on_creator_follow();

CREATE OR REPLACE FUNCTION activity_on_creator_like()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_user_id uuid;
BEGIN
  IF NEW.reaction <> 'like' THEN RETURN NEW; END IF;
  SELECT creator_user_id INTO target_user_id FROM creator_content WHERE id=NEW.content_id;
  PERFORM enqueue_creator_activity(
    target_user_id,NEW.user_id,'content_like','social','creator_content',NEW.content_id,
    'Nova curtida','like:'||NEW.content_id::text||':'||NEW.user_id::text,
    jsonb_build_object('contentId',NEW.content_id)
  );
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS creator_activity_like_trigger ON creator_content_reactions;
CREATE TRIGGER creator_activity_like_trigger AFTER INSERT ON creator_content_reactions
FOR EACH ROW EXECUTE FUNCTION activity_on_creator_like();

CREATE OR REPLACE FUNCTION activity_on_creator_comment()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_user_id uuid;
BEGIN
  SELECT creator_user_id INTO target_user_id FROM creator_content WHERE id=NEW.content_id;
  PERFORM enqueue_creator_activity(
    target_user_id,NEW.author_user_id,'content_comment','social','creator_content',NEW.content_id,
    'Novo comentário','comment:'||NEW.id::text,
    jsonb_build_object('contentId',NEW.content_id,'commentId',NEW.id)
  );
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS creator_activity_comment_trigger ON creator_content_comments;
CREATE TRIGGER creator_activity_comment_trigger AFTER INSERT ON creator_content_comments
FOR EACH ROW EXECUTE FUNCTION activity_on_creator_comment();

CREATE OR REPLACE FUNCTION activity_on_dm_thread()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_user_id uuid;
BEGIN
  IF NEW.status <> 'pending' THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND OLD.status IS NOT DISTINCT FROM NEW.status AND OLD.requested_at IS NOT DISTINCT FROM NEW.requested_at THEN
    RETURN NEW;
  END IF;
  target_user_id := CASE WHEN NEW.requested_by_user_id=NEW.user_low_id THEN NEW.user_high_id ELSE NEW.user_low_id END;
  PERFORM enqueue_creator_activity(
    target_user_id,NEW.requested_by_user_id,'dm_request','messages','dm_thread',NEW.id,
    'Novo pedido de mensagem','dm_request:'||NEW.id::text||':'||extract(epoch FROM NEW.requested_at)::bigint::text,
    jsonb_build_object('threadId',NEW.id)
  );
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS creator_activity_dm_thread_trigger ON creator_dm_threads;
CREATE TRIGGER creator_activity_dm_thread_trigger AFTER INSERT OR UPDATE OF status,requested_at ON creator_dm_threads
FOR EACH ROW EXECUTE FUNCTION activity_on_dm_thread();

CREATE OR REPLACE FUNCTION activity_on_dm_message()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_user_id uuid;
BEGIN
  IF NEW.message_kind <> 'message' THEN RETURN NEW; END IF;
  SELECT CASE WHEN user_low_id=NEW.sender_user_id THEN user_high_id ELSE user_low_id END
    INTO target_user_id FROM creator_dm_threads WHERE id=NEW.thread_id;
  PERFORM enqueue_creator_activity(
    target_user_id,NEW.sender_user_id,'dm_message','messages','dm_thread',NEW.thread_id,
    'Nova mensagem privada','dm_message:'||NEW.id::text,
    jsonb_build_object('threadId',NEW.thread_id,'messageId',NEW.id)
  );
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS creator_activity_dm_message_trigger ON creator_dm_messages;
CREATE TRIGGER creator_activity_dm_message_trigger AFTER INSERT ON creator_dm_messages
FOR EACH ROW EXECUTE FUNCTION activity_on_dm_message();

CREATE OR REPLACE FUNCTION activity_on_content_sale()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM enqueue_creator_activity(
    NEW.creator_user_id,NEW.buyer_user_id,'content_sale','economy','creator_content',NEW.content_id,
    'Conteúdo vendido','content_sale:'||NEW.id::text,
    jsonb_build_object('contentId',NEW.content_id,'grossMinor',NEW.gross_minor,'creatorNetMinor',NEW.creator_net_minor)
  );
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS creator_activity_content_sale_trigger ON creator_content_purchases;
CREATE TRIGGER creator_activity_content_sale_trigger AFTER INSERT ON creator_content_purchases
FOR EACH ROW EXECUTE FUNCTION activity_on_content_sale();

CREATE OR REPLACE FUNCTION activity_on_ugc_primary_sale()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM enqueue_creator_activity(
    NEW.creator_user_id,NEW.buyer_user_id,'ugc_primary_sale','economy','ugc_blueprint',NEW.blueprint_id,
    'Objeto UGC vendido','ugc_primary:'||NEW.id::text,
    jsonb_build_object('blueprintId',NEW.blueprint_id,'instanceId',NEW.instance_id,'grossMinor',NEW.gross_minor,'creatorNetMinor',NEW.creator_net_minor)
  );
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS creator_activity_ugc_primary_trigger ON ugc_primary_sales;
CREATE TRIGGER creator_activity_ugc_primary_trigger AFTER INSERT ON ugc_primary_sales
FOR EACH ROW EXECUTE FUNCTION activity_on_ugc_primary_sale();

CREATE OR REPLACE FUNCTION activity_on_ugc_trade()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM enqueue_creator_activity(
    NEW.seller_user_id,NEW.buyer_user_id,'ugc_resale','economy','ugc_instance',NEW.instance_id,
    'Objeto UGC revendido','ugc_resale:'||NEW.id::text,
    jsonb_build_object('instanceId',NEW.instance_id,'grossMinor',NEW.gross_minor,'sellerNetMinor',NEW.seller_net_minor)
  );
  IF NEW.royalty_minor > 0 AND NEW.creator_user_id <> NEW.seller_user_id THEN
    PERFORM enqueue_creator_activity(
      NEW.creator_user_id,NEW.buyer_user_id,'ugc_royalty','economy','ugc_instance',NEW.instance_id,
      'Royalty de revenda recebido','ugc_royalty:'||NEW.id::text,
      jsonb_build_object('instanceId',NEW.instance_id,'royaltyMinor',NEW.royalty_minor)
    );
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS creator_activity_ugc_trade_trigger ON ugc_market_trades;
CREATE TRIGGER creator_activity_ugc_trade_trigger AFTER INSERT ON ugc_market_trades
FOR EACH ROW EXECUTE FUNCTION activity_on_ugc_trade();

CREATE OR REPLACE FUNCTION activity_on_ad_settlement()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM enqueue_creator_activity(
    NEW.publisher_user_id,NEW.advertiser_user_id,'ad_revenue','economy','ad_placement',NEW.placement_id,
    'Receita publicitária liquidada','ad_revenue:'||NEW.id::text,
    jsonb_build_object('placementId',NEW.placement_id,'publisherMinor',NEW.publisher_minor)
  );
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS creator_activity_ad_settlement_trigger ON economy_ad_settlements;
CREATE TRIGGER creator_activity_ad_settlement_trigger AFTER INSERT ON economy_ad_settlements
FOR EACH ROW EXECUTE FUNCTION activity_on_ad_settlement();

CREATE OR REPLACE FUNCTION activity_on_competition_finance()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.event_type='prize_payout' AND NEW.beneficiary_user_id IS NOT NULL THEN
    PERFORM enqueue_creator_activity(
      NEW.beneficiary_user_id,NEW.actor_user_id,'competition_prize','economy','competition',NEW.competition_id,
      'Prêmio de competição recebido','competition_prize:'||NEW.id::text,
      jsonb_build_object('competitionId',NEW.competition_id,'amountMinor',NEW.amount_minor)
    );
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS creator_activity_competition_trigger ON player_competition_finance_events;
CREATE TRIGGER creator_activity_competition_trigger AFTER INSERT ON player_competition_finance_events
FOR EACH ROW EXECUTE FUNCTION activity_on_competition_finance();

CREATE OR REPLACE FUNCTION activity_on_moderation_result()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner_id uuid;
BEGIN
  IF NEW.status NOT IN ('resolved','dismissed') OR OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;
  PERFORM enqueue_creator_activity(
    NEW.reporter_user_id,NEW.assigned_to,'moderation_report_result','safety','moderation_report',NEW.id,
    'Sua denúncia foi analisada','moderation_report:'||NEW.id::text||':'||NEW.status,
    jsonb_build_object('reportId',NEW.id,'outcome',NEW.status,'resourceType',NEW.resource_type)
  );
  IF NEW.status='resolved' THEN
    owner_id := creator_activity_resource_owner(NEW.resource_type,NEW.resource_id);
    PERFORM enqueue_creator_activity(
      owner_id,NEW.assigned_to,'moderation_restricted','safety','moderation_report',NEW.id,
      'Recurso restringido pela moderação','moderation_restricted:'||NEW.id::text,
      jsonb_build_object('reportId',NEW.id,'resourceType',NEW.resource_type,'resourceId',NEW.resource_id)
    );
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS creator_activity_moderation_trigger ON creator_economy_reports;
CREATE TRIGGER creator_activity_moderation_trigger AFTER UPDATE OF status ON creator_economy_reports
FOR EACH ROW EXECUTE FUNCTION activity_on_moderation_result();

CREATE OR REPLACE FUNCTION activity_on_appeal_result()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status NOT IN ('upheld','overturned') OR OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;
  PERFORM enqueue_creator_activity(
    NEW.appellant_user_id,NEW.reviewer_user_id,'appeal_resolved','safety','moderation_appeal',NEW.id,
    CASE WHEN NEW.status='overturned' THEN 'Apelação acolhida' ELSE 'Apelação mantida' END,
    'appeal:'||NEW.id::text||':'||NEW.status,
    jsonb_build_object('appealId',NEW.id,'outcome',NEW.status,'reportId',NEW.report_id)
  );
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS creator_activity_appeal_trigger ON creator_economy_appeals;
CREATE TRIGGER creator_activity_appeal_trigger AFTER UPDATE OF status ON creator_economy_appeals
FOR EACH ROW EXECUTE FUNCTION activity_on_appeal_result();

COMMIT;

-- Tehkné Solutions
