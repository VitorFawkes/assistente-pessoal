-- ─────────────────────────────────────────────────────────────────────
-- Segmentação de áudio longo em N meetings filhos.
-- Cada filho mantém referência ao pai (archived_session) via parent_meeting_id.
-- Aplicar manualmente via dbgate/pgweb (projeto não tem migration tool).
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE meetings
  ADD COLUMN IF NOT EXISTS parent_meeting_id UUID NULL
    REFERENCES meetings(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS segment_index INT NULL,
  ADD COLUMN IF NOT EXISTS segment_start_offset REAL NULL,
  ADD COLUMN IF NOT EXISTS segment_end_offset REAL NULL,
  ADD COLUMN IF NOT EXISTS needs_segmentation BOOLEAN NOT NULL DEFAULT false;

-- O status original tem CHECK com 5 valores. Expande pra incluir o estado final
-- de "pai arquivado após segmentação". Pais ficam invisíveis no /reunioes.
ALTER TABLE meetings DROP CONSTRAINT IF EXISTS meetings_status_check;
ALTER TABLE meetings ADD CONSTRAINT meetings_status_check
  CHECK (status IN ('received','transcribing','analyzing','done','error','archived_session'));

-- O source original aceita só ('macbook','iphone'). Filhos terão source='segmented'.
ALTER TABLE meetings DROP CONSTRAINT IF EXISTS meetings_source_check;
ALTER TABLE meetings ADD CONSTRAINT meetings_source_check
  CHECK (source IN ('macbook','iphone','segmented'));

CREATE INDEX IF NOT EXISTS meetings_parent_idx
  ON meetings(parent_meeting_id) WHERE parent_meeting_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS meetings_needs_seg_idx
  ON meetings(needs_segmentation) WHERE needs_segmentation = true;

COMMENT ON COLUMN meetings.parent_meeting_id IS
  'Aponta pro meeting-pai (status=archived_session) que originou este segmento. NULL = meeting raiz.';
COMMENT ON COLUMN meetings.segment_index IS
  'Ordem do segmento dentro do pai (0,1,2,...). NULL em meetings raiz.';
COMMENT ON COLUMN meetings.segment_start_offset IS
  'Segundos no áudio do pai onde este segmento começa. NULL em raiz.';
COMMENT ON COLUMN meetings.segment_end_offset IS
  'Segundos no áudio do pai onde este segmento termina. NULL em raiz.';
COMMENT ON COLUMN meetings.needs_segmentation IS
  'Marcado pelo n8n quando duração > 60min, sinaliza pra UI mostrar banner.';
