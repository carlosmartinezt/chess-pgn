export interface SessionSummary {
  session_id: string;
  white_player: string;
  black_player: string;
  date: string | null;
  event: string | null;
  total_verified: number;
  status: string;
  created_at: number;
  updated_at: number;
}

export interface LegalCandidate {
  san: string;
  original_text: string;
  uci: string;
}

export interface Validation {
  status: string;
  verified_moves: string[];
  total_verified: number;
  board_fen?: string;
  problem_at?: { move_number: number; color: string };
  original_text?: string;
  legal_candidates?: LegalCandidate[];
  context?: {
    fen: string;
    side_to_move: string;
    legal_moves_count: number;
    legal_moves: string[];
    in_check: boolean;
    move_number: number;
  };
}

export interface Headers {
  event?: string | null;
  white_player?: string | null;
  black_player?: string | null;
  date?: string | null;
  section?: string | null;
  result?: string | null;
}

export interface Transcription {
  white_player?: string | null;
  black_player?: string | null;
  event?: string | null;
  section?: string | null;
  date?: string | null;
  result?: string | null;
  moves: Array<{
    number: number;
    white?: { text: string; confidence: string; alternatives?: string[] };
    black?: { text: string; confidence: string; alternatives?: string[] };
  }>;
}

export interface SessionData {
  session_id?: string;
  transcription: Transcription;
  validation: Validation;
  pgn: string;
  headers: Headers;
}

export interface SessionState {
  confirmed_moves: string[];
  headers: Headers;
  transcription: Transcription;
  session_id: string;
}
