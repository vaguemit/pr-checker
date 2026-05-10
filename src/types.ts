export type Severity  = 'critical' | 'warning' | 'suggestion' | 'nit';
export type RiskLevel = 'low' | 'medium' | 'high';

export interface ReviewComment {
  path:     string;
  line:     number;
  severity: Severity;
  body:     string;
}

export interface ReviewSummary {
  overview:    string;
  risk_level:  RiskLevel;
  key_changes: string[];
  concerns:    string[];
}

export interface ReviewResult {
  summary:  ReviewSummary;
  comments: ReviewComment[];
}

export interface PRFile {
  filename:  string;
  status:    string;
  patch?:    string;
  additions: number;
  deletions: number;
}
