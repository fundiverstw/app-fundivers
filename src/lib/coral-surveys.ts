import { supabase } from './supabase'
import type { CoralColony, CoralSurveyMethod, CoralSurveyRow } from '../types/database'

// Data access for coral surveys. Every call is an RPC: the tables grant
// `authenticated` nothing but SELECT, so the rules about who may write what,
// and when, live in the SECURITY DEFINER functions rather than being spread
// across policies. See 20260822000000_coral_surveys.sql.

export interface CoralSurveyInput {
  siteId: string
  surveyedOn: string
  colonies: CoralColony[]
  surveyedAt?: string | null
  depthM?: number | null
  waterTempC?: number | null
  method?: CoralSurveyMethod
  transectLengthM?: number | null
  notes?: string | null
}

/** File a survey, or revise the one this diver already filed for that site and
 *  day. Returns the survey id. Rejects a survey with no colonies, a future
 *  date, or a revision of a survey staff have already ruled on. */
export async function submitCoralSurvey(input: CoralSurveyInput): Promise<string> {
  const { data, error } = await supabase.rpc('submit_coral_survey', {
    p_site_id: input.siteId,
    p_surveyed_on: input.surveyedOn,
    p_colonies: input.colonies,
    p_surveyed_at: input.surveyedAt ?? null,
    p_depth_m: input.depthM ?? null,
    p_water_temp_c: input.waterTempC ?? null,
    p_survey_method: input.method ?? 'random',
    p_transect_length_m: input.transectLengthM ?? null,
    p_notes: input.notes ?? null,
  })
  if (error) throw error
  return data as string
}

/** Approved surveys over a date window — what the crowd reads. */
export async function fetchCoralSurveys(from: string, to: string): Promise<CoralSurveyRow[]> {
  const { data, error } = await supabase.rpc('coral_surveys_in_range', { p_from: from, p_to: to })
  if (error) throw error
  return (data ?? []) as CoralSurveyRow[]
}

/** The review queue. Staff and admin only; raises otherwise. */
export async function fetchPendingCoralSurveys(): Promise<CoralSurveyRow[]> {
  const { data, error } = await supabase.rpc('coral_pending_surveys')
  if (error) throw error
  return (data ?? []) as CoralSurveyRow[]
}

export async function moderateCoralSurvey(
  surveyId: string,
  status: 'approved' | 'rejected',
  staffNotes?: string | null,
): Promise<void> {
  const { error } = await supabase.rpc('moderate_coral_survey', {
    p_survey_id: surveyId,
    p_status: status,
    p_staff_notes: staffNotes ?? null,
  })
  if (error) throw error
}
