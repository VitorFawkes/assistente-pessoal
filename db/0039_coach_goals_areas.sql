-- Objetivos de trabalho e de vida no Coach (até 3 ativos em cada área). Aditiva e repetível.
-- Objetivo continua sendo uma memória kind='goal'; sem área = trabalho.
BEGIN;
ALTER TABLE coach_memories ADD COLUMN IF NOT EXISTS goal_area text CHECK (goal_area IN ('work','life'));
ALTER TABLE coach_memories ADD COLUMN IF NOT EXISTS goal_due date;
ALTER TABLE coach_memories ADD COLUMN IF NOT EXISTS goal_measure text CHECK (length(goal_measure) <= 500);
COMMIT;
