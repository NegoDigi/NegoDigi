export type EditorMetricRow = {
  organization_id: string; editor_id: string; editor_name: string; period_key: string;
  submitted_videos: number | string; approved_videos: number | string;
  approved_without_correction_videos: number | string;
  corrected_approved_videos: number | string;
  late_videos: number | string; on_time_videos: number | string;
  correction_count: number | string; correction_videos: number | string;
  client_amount: number | string; editor_amount: number | string; net_profit: number | string;
  assigned_videos: number | string; completed_videos: number | string;
  first_pass_approval_rate: number | string;
  productive_minutes?: number | string;
  activity_days?: number | string;
  v2_late_videos?: number | string;
  v2_priority_late_videos?: number | string;
  v2_corrected_approved_videos?: number | string;
  v2_approved_without_correction_videos?: number | string;
  v2_correction_count?: number | string;
};

export type RankingSettings = {
  organization_id: string;
  value_weight: number | string; quality_weight: number | string;
  punctuality_weight: number | string;
  /** Historical compatibility only. Penalties are stored separately. */
  correction_weight: number | string;
  late_penalty_points?: number | string;
  correction_penalty_points?: number | string;
  min_approved_videos: number | string;
  /** Historical compatibility only. It is not scored or shown. */
  commitment_weight?: number | string;
  completion_weight?: number | string;
  /** Historical compatibility only. The live ranking has four criteria. */
  rework_weight?: number | string;
  activity_weight?: number | string;
  /** Current ranking (v2): 30/30/20/20 from the effective period. */
  v2_punctuality_weight?: number | string;
  v2_communication_weight?: number | string;
  v2_quality_weight?: number | string;
  v2_production_weight?: number | string;
  v2_daily_activity_cap?: number | string;
  v2_priority_late_multiplier?: number | string;
  v2_effective_from_period?: string | null;
};

export type EditorCommunicationReview = {
  editor_id: string;
  week_start: string;
  score: number | string;
  note?: string | null;
};

export type DailyRankingPoint = {
  editor_id: string;
  claimed_at: string;
  points: number | string;
};

export type V2RankingContext = {
  periodKey: string;
  communicationReviews?: EditorCommunicationReview[];
  dailyPoints?: DailyRankingPoint[];
};

export type EditorReward = {
  id: string; period_key: string; rank_position: number; amount: number | string;
  name?: string | null; description: string | null;
  reward_type?: "monetary" | "non_monetary" | "special" | "random" | string;
  status: string;
};

export type ScorePart = {
  key: "value" | "quality" | "punctuality" | "communication" | "production" | "late_penalty" | "correction_penalty" | "manual_adjustment";
  label: string; value: number; weight: number; points: number; evidence: string; missing?: string;
  valueLabel?: string; weightLabel?: string;
};

export type RankedEditor = {
  row: EditorMetricRow; eligible: boolean; ineligibleReason: string | null;
  provisional: boolean; score: number; rank: number | null; previousRank: number | null; variation: number | null;
  parts: ScorePart[]; reward: EditorReward | null; quality: number; punctuality: number;
  communication?: number; production?: number;
};

export const defaultRankingSettings: RankingSettings = {
  organization_id: "", value_weight: 40, quality_weight: 30,
  punctuality_weight: 30, correction_weight: 0,
  late_penalty_points: 2, correction_penalty_points: 1, min_approved_videos: 3,
  v2_punctuality_weight: 30, v2_communication_weight: 30,
  v2_quality_weight: 20, v2_production_weight: 20,
  v2_daily_activity_cap: 5, v2_priority_late_multiplier: 1.5,
  v2_effective_from_period: "2026-10",
};

const n = (value: number | string | null | undefined) => {
  const parsed = Number(value ?? 0); return Number.isFinite(parsed) ? parsed : 0;
};
const pct = (value: number) => Math.max(0, Math.min(100, value));
const round = (value: number) => Math.round(value * 10) / 10;

function rankRows(rows: EditorMetricRow[], settings: RankingSettings, rewards: EditorReward[]) {
  const maxValue = Math.max(1, ...rows.map((row) => n(row.client_amount)));
  const weights = {
    value: n(settings.value_weight), quality: n(settings.quality_weight),
    punctuality: n(settings.punctuality_weight),
  };
  const penalties = {
    late: Math.max(0, n(settings.late_penalty_points ?? 2)),
    corrections: Math.max(0, n(settings.correction_penalty_points ?? 1)),
  };
  const minimum = Math.max(1, n(settings.min_approved_videos));
  const result = rows.map((row) => {
    const approved = n(row.approved_videos), direct = n(row.approved_without_correction_videos);
    const corrected = n(row.corrected_approved_videos), onTime = n(row.on_time_videos), late = n(row.late_videos);
    const correctionVideos = n(row.correction_videos), correctionRounds = n(row.correction_count);
    const value = pct(n(row.client_amount) * 100 / maxValue);
    const quality = pct(approved ? direct * 100 / approved : 0);
    const punctuality = pct(onTime + late ? onTime * 100 / (onTime + late) : 0);
    const latePenalty = round(late * penalties.late);
    const correctionPenalty = round(correctionRounds * penalties.corrections);
    const provisional = approved < minimum;
    const parts: ScorePart[] = [
      { key:"value", label:"Valor generado", value:round(value), weight:weights.value, points:round(value*weights.value/100), evidence:`${n(row.client_amount).toFixed(2)} € en entregas aprobadas`, missing:approved ? undefined : "Aún no hay entregas aprobadas" },
      { key:"quality", label:"Calidad a la primera", value:round(quality), weight:weights.quality, points:round(quality*weights.quality/100), evidence:`${direct} aprobados a la primera · ${corrected} corregidos y aprobados`, missing:approved ? undefined : "Aún no hay vídeos revisados" },
      { key:"punctuality", label:"Puntualidad", value:round(punctuality), weight:weights.punctuality, points:round(punctuality*weights.punctuality/100), evidence:`${onTime} puntuales · ${late} retrasados`, missing:onTime+late ? undefined : "Aún no hay entregas fechadas" },
      { key:"late_penalty", label:"Penalización por retrasos", value:late, weight:penalties.late, points:-latePenalty, valueLabel:`${late} retrasados`, weightLabel:`−${penalties.late} pt/vídeo`, evidence:`${late} entrega${late === 1 ? "" : "s"} fuera de fecha`, missing:onTime+late ? "Aún no hay entregas fechadas" : undefined },
      { key:"correction_penalty", label:"Penalización por correcciones", value:correctionRounds, weight:penalties.corrections, points:-correctionPenalty, valueLabel:`${correctionRounds} correcciones`, weightLabel:`−${penalties.corrections} pt/corrección`, evidence:`${correctionVideos} vídeos con correcciones · ${correctionRounds} rondas`, missing:approved ? undefined : "Aún no hay vídeos revisados" },
    ];
    return {
      row, eligible:true, provisional,
      ineligibleReason: provisional ? `Muestra inicial: ${approved} de ${minimum} vídeos aprobados` : null,
      score:Math.max(0, round(parts.reduce((sum,part)=>sum+part.points,0))), rank:null as number|null,
      previousRank:null as number|null, variation:null as number|null, parts, reward:null as EditorReward|null, quality, punctuality,
    };
  });
  result.sort((a,b)=>b.score-a.score || b.quality-a.quality || b.punctuality-a.punctuality || n(b.row.client_amount)-n(a.row.client_amount) || a.row.editor_id.localeCompare(b.row.editor_id));
  result.forEach((entry,index)=>{ entry.rank=index+1; entry.reward=rewards.find((reward)=>reward.status==="active" && reward.rank_position===entry.rank) || null; });
  return result;
}

export function scoreEditorPerformance(rows: EditorMetricRow[], settings: RankingSettings = defaultRankingSettings, rewards: EditorReward[] = [], previousRows: EditorMetricRow[] = []): RankedEditor[] {
  const current=rankRows(rows,settings,rewards), previous=new Map(rankRows(previousRows,settings,[]).map((entry)=>[entry.row.editor_id,entry.rank]));
  return current.map((entry)=>{ const previousRank=previous.get(entry.row.editor_id) ?? null; return {...entry,previousRank,variation:entry.rank && previousRank ? previousRank-entry.rank : null}; });
}

/**
 * Current Editor del mes calculation. This is deliberately separate from the
 * legacy scorer so closed historical snapshots keep rendering exactly as they
 * were saved. It never uses client prices: production is based on approved
 * volume relative to the current team's approved volume.
 */
export function scoreEditorPerformanceV2(
  rows: EditorMetricRow[],
  settings: RankingSettings = defaultRankingSettings,
  rewards: EditorReward[] = [],
  previousRows: EditorMetricRow[] = [],
  context: V2RankingContext = { periodKey: "" },
  previousContext?: V2RankingContext,
): RankedEditor[] {
  const weights = {
    punctuality: Math.max(0, n(settings.v2_punctuality_weight ?? 30)),
    communication: Math.max(0, n(settings.v2_communication_weight ?? 30)),
    quality: Math.max(0, n(settings.v2_quality_weight ?? 20)),
    production: Math.max(0, n(settings.v2_production_weight ?? 20)),
  };
  const dailyCap = Math.max(0, n(settings.v2_daily_activity_cap ?? 5));
  const priorityLateMultiplier = Math.max(
    1,
    n(settings.v2_priority_late_multiplier ?? 1.5),
  );
  const minimum = Math.max(1, n(settings.min_approved_videos));
  const maxApproved = Math.max(1, ...rows.map((row) => n(row.approved_videos)));
  const reviews = context.communicationReviews || [];
  const dailyPoints = context.dailyPoints || [];
  const reviewScoresByEditor = new Map<string, number[]>();
  reviews.forEach((review) => {
    if (context.periodKey && !String(review.week_start || "").startsWith(context.periodKey)) return;
    const score = Math.max(0, Math.min(5, n(review.score)));
    const current = reviewScoresByEditor.get(review.editor_id) || [];
    current.push(score);
    reviewScoresByEditor.set(review.editor_id, current);
  });
  const dailyByEditor = new Map<string, number>();
  dailyPoints.forEach((point) => {
    if (context.periodKey && !String(point.claimed_at || "").startsWith(context.periodKey)) return;
    dailyByEditor.set(
      point.editor_id,
      (dailyByEditor.get(point.editor_id) || 0) + Math.max(0, n(point.points)),
    );
  });
  const current = rows.map((row) => {
    const approved = n(row.approved_videos);
    const direct =
      row.v2_approved_without_correction_videos === undefined
        ? n(row.approved_without_correction_videos)
        : n(row.v2_approved_without_correction_videos);
    const legacyLate = n(row.late_videos);
    const late =
      row.v2_late_videos === undefined
        ? legacyLate
        : n(row.v2_late_videos);
    const priorityLate = Math.min(
      late,
      n(row.v2_priority_late_videos),
    );
    const onTime =
      n(row.on_time_videos) + Math.max(0, legacyLate - late);
    const weightedLate =
      late + priorityLate * (priorityLateMultiplier - 1);
    const dated = onTime + weightedLate;
    const punctuality = pct(dated ? (onTime * 100) / dated : 0);
    const quality = pct(approved ? (direct * 100) / approved : 0);
    const production = pct((approved * 100) / maxApproved);
    const reviewScores = reviewScoresByEditor.get(row.editor_id) || [];
    const averageCommunication = reviewScores.length
      ? reviewScores.reduce((sum, score) => sum + score, 0) / reviewScores.length
      : 0;
    const reviewPoints = (averageCommunication / 5) * Math.max(0, weights.communication - dailyCap);
    const activityPoints = Math.min(dailyCap, dailyByEditor.get(row.editor_id) || 0);
    const communicationPoints = Math.min(weights.communication, reviewPoints + activityPoints);
    const parts: ScorePart[] = [
      {
        key: "punctuality",
        label: "Puntualidad",
        value: round(punctuality),
        weight: weights.punctuality,
        points: round((punctuality * weights.punctuality) / 100),
        evidence: priorityLate
          ? `${onTime} puntuales · ${late} retrasados (${priorityLate} prioritarios)`
          : `${onTime} puntuales · ${late} retrasados`,
        missing: dated ? undefined : "Aún no hay entregas fechadas",
      },
      {
        key: "communication",
        label: "Comunicación",
        value: round(weights.communication ? (communicationPoints * 100) / weights.communication : 0),
        weight: weights.communication,
        points: round(communicationPoints),
        evidence: reviewScores.length
          ? `${round(averageCommunication)}/5 de media · ${round(activityPoints)} pt de actividad diaria`
          : `Pendiente de evaluación · ${round(activityPoints)} pt de actividad diaria`,
        missing: reviewScores.length ? undefined : "Semana pendiente de evaluar",
        valueLabel: `${round(averageCommunication)}/5`,
      },
      {
        key: "quality",
        label: "Calidad a la primera",
        value: round(quality),
        weight: weights.quality,
        points: round((quality * weights.quality) / 100),
        evidence: `${direct} aprobados a la primera · ${Math.max(0, approved - direct)} con corrección atribuible`,
        missing: approved ? undefined : "Aún no hay vídeos revisados",
      },
      {
        key: "production",
        label: "Producción",
        value: round(production),
        weight: weights.production,
        points: round((production * weights.production) / 100),
        evidence: `${approved} trabajos aprobados · máximo del periodo: ${maxApproved}`,
        missing: approved ? undefined : "Aún no hay trabajos aprobados",
      },
    ];
    const provisional = approved < minimum;
    const total = Math.max(0, Math.min(100, round(parts.reduce((sum, part) => sum + part.points, 0))));
    return {
      row,
      eligible: true,
      provisional,
      ineligibleReason: provisional ? `Muestra inicial: ${approved} de ${minimum} vídeos aprobados` : null,
      score: total,
      rank: null as number | null,
      previousRank: null as number | null,
      variation: null as number | null,
      parts,
      reward: null as EditorReward | null,
      quality,
      punctuality,
      communication: round(communicationPoints),
      production: round((production * weights.production) / 100),
    };
  });
  current.sort(
    (a, b) =>
      b.score - a.score ||
      numberValue(b.production) - numberValue(a.production) ||
      b.quality - a.quality ||
      b.punctuality - a.punctuality ||
      a.row.editor_id.localeCompare(b.row.editor_id),
  );
  current.forEach((entry, index) => {
    entry.rank = index + 1;
    // A minimum production sample is required to opt for a reward, but the
    // editor remains visible in the ranking while the month is in progress.
    entry.reward = !entry.provisional
      ? rewards.find((reward) => reward.status === "active" && reward.rank_position === entry.rank) || null
      : null;
  });
  if (previousRows.length) {
    const previous = scoreEditorPerformanceV2(
      previousRows,
      settings,
      [],
      [],
      previousContext || { periodKey: "" },
    );
    const previousByEditor = new Map(previous.map((entry) => [entry.row.editor_id, entry.rank]));
    current.forEach((entry) => {
      const previousRank = previousByEditor.get(entry.row.editor_id) ?? null;
      entry.previousRank = previousRank;
      entry.variation = entry.rank && previousRank ? previousRank - entry.rank : null;
    });
  }
  return current;
}

function numberValue(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}
