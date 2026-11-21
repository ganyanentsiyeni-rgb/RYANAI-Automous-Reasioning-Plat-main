/**
 * Privacy-safe, normalized provenance for GitHub pull-request reviews.
 *
 * The GitHub adapter must map only fields explicitly returned by GitHub's
 * review-attribution API into this contract. Never pass review/comment bodies,
 * prompts, tool arguments, source names, or custom-instruction content here.
 */
export type ReviewActorKind = 'human' | 'copilot' | 'unknown';
export type ReviewState = 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING' | 'UNKNOWN';
export type ReviewCommentSourceKind = 'skill' | 'mcp' | 'custom_instructions' | 'other';

export interface ReviewCommentAttribution {
  commentId: string;
  sourceKinds: ReviewCommentSourceKind[];
}

export interface CopilotReviewProvenanceInput {
  reviewId: string;
  pullRequestNumber: number;
  reviewedCommitSha: string;
  submittedAt: string;
  state: string;
  actorKind: ReviewActorKind;
  /** Provider-reported review tier; do not infer from settings or estimated cost. */
  effortLevel?: string | null;
  /** Per-comment source categories only; no comment body or source name is retained. */
  commentAttributions?: Array<{ commentId: string; sourceKinds: string[] }> | null;
}

export interface CopilotReviewProvenance {
  schemaVersion: 'ryanai.github-review-provenance/v1';
  reviewId: string;
  pullRequestNumber: number;
  reviewedCommitSha: string;
  submittedAt: string;
  state: ReviewState;
  actorKind: ReviewActorKind;
  effortLevel?: 'auto' | 'lite' | 'balanced' | 'max';
  commentAttributions: ReviewCommentAttribution[];
}

const SHA_PATTERN = /^[a-f0-9]{40}$/i;
const SOURCE_KINDS = new Set<ReviewCommentSourceKind>([
  'skill', 'mcp', 'custom_instructions', 'other',
]);
const REVIEW_STATES = new Set<ReviewState>([
  'APPROVED', 'CHANGES_REQUESTED', 'COMMENTED', 'DISMISSED', 'PENDING', 'UNKNOWN',
]);

function boundedIdentifier(value: string, maxLength = 80): string {
  return value.trim().slice(0, maxLength);
}

/** Returns null for malformed or incomplete upstream evidence; never guesses attribution. */
export function normalizeReviewProvenance(
  input: CopilotReviewProvenanceInput,
): CopilotReviewProvenance | null {
  if (!input || typeof input !== 'object') return null;
  if (typeof input.reviewId !== 'string' || typeof input.submittedAt !== 'string' ||
      typeof input.reviewedCommitSha !== 'string') return null;
  const reviewId = boundedIdentifier(input.reviewId, 80);
  const submittedAtMs = Date.parse(input.submittedAt);
  if (
    !reviewId ||
    !Number.isSafeInteger(input.pullRequestNumber) ||
    input.pullRequestNumber <= 0 ||
    !SHA_PATTERN.test(input.reviewedCommitSha) ||
    !Number.isFinite(submittedAtMs) ||
    submittedAtMs > Date.now()
  ) return null;

  const rawState = String(input.state).toUpperCase();
  const state = REVIEW_STATES.has(rawState as ReviewState) ? rawState as ReviewState : 'UNKNOWN';
  const actorKind: ReviewActorKind = input.actorKind === 'human' || input.actorKind === 'copilot'
    ? input.actorKind
    : 'unknown';

  const effortLevel = input.effortLevel === 'auto' || input.effortLevel === 'lite' ||
    input.effortLevel === 'balanced' || input.effortLevel === 'max'
    ? input.effortLevel
    : undefined;

  const commentAttributions = Array.isArray(input.commentAttributions)
    ? input.commentAttributions.slice(0, 200).flatMap((entry) => {
        if (!entry || typeof entry.commentId !== 'string' || !Array.isArray(entry.sourceKinds)) return [];
        const commentId = boundedIdentifier(entry.commentId, 80);
        if (!commentId) return [];
        const sourceKinds = [...new Set(entry.sourceKinds.filter(
          (kind): kind is ReviewCommentSourceKind =>
            typeof kind === 'string' && SOURCE_KINDS.has(kind as ReviewCommentSourceKind),
        ))].slice(0, 10);
        return sourceKinds.length ? [{ commentId, sourceKinds }] : [];
      })
    : [];

  return {
    schemaVersion: 'ryanai.github-review-provenance/v1',
    reviewId,
    pullRequestNumber: input.pullRequestNumber,
    reviewedCommitSha: input.reviewedCommitSha.toLowerCase(),
    submittedAt: new Date(submittedAtMs).toISOString(),
    state,
    actorKind,
    ...(effortLevel ? { effortLevel } : {}),
    commentAttributions,
  };
}

/**
 * Copilot is advisory. An approval counts only when GitHub explicitly
 * attributes it to a human and the review is bound to the exact current head.
 */
export function isEligibleHumanApproval(
  review: CopilotReviewProvenance,
  currentHeadSha: string,
): boolean {
  return review.actorKind === 'human' &&
    review.state === 'APPROVED' &&
    SHA_PATTERN.test(currentHeadSha) &&
    review.reviewedCommitSha === currentHeadSha.toLowerCase();
}
