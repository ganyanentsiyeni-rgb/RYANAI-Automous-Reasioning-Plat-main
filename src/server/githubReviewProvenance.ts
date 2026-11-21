import {
  isEligibleHumanApproval,
  normalizeReviewProvenance,
  type CopilotReviewProvenance,
} from '../lib/githubReviewProvenance.js';

type GraphQLComment = {
  id?: unknown;
  isCopilotCodeReview?: unknown;
  copilotCodeReviewSources?: Array<{ kind?: unknown }> | null;
};

type GraphQLReview = {
  id?: unknown;
  state?: unknown;
  submittedAt?: unknown;
  commit?: { oid?: unknown } | null;
  author?: { __typename?: unknown } | null;
  isCopilotCodeReview?: unknown;
  copilotCodeReviewEffort?: unknown;
  comments?: {
    nodes?: GraphQLComment[] | null;
    pageInfo?: { hasNextPage?: unknown } | null;
  } | null;
};

export interface GraphQLPullRequestReviewPayload {
  repository?: {
    pullRequest?: {
      headRefOid?: unknown;
      reviews?: {
        nodes?: GraphQLReview[] | null;
        totalCount?: unknown;
        pageInfo?: { hasNextPage?: unknown } | null;
      } | null;
    } | null;
  } | null;
}

export interface PullRequestReviewProvenanceSnapshot {
  schemaVersion: 'ryanai.github-review-provenance-snapshot/v1';
  pullRequestNumber: number;
  headSha: string;
  complete: boolean;
  returnedReviewCount: number;
  reportedReviewCount: number | null;
  copilotReviewCount: number;
  exactHeadHumanApprovalCount: number;
  reviews: CopilotReviewProvenance[];
}

/** Map only explicit GraphQL provenance fields; never copy review/comment bodies or source names/paths. */
export function mapPullRequestReviewProvenance(
  payload: GraphQLPullRequestReviewPayload,
  pullRequestNumber: number,
): PullRequestReviewProvenanceSnapshot | null {
  const pullRequest = payload?.repository?.pullRequest;
  const headSha = pullRequest?.headRefOid;
  const connection = pullRequest?.reviews;
  if (
    !Number.isSafeInteger(pullRequestNumber) || pullRequestNumber <= 0 ||
    typeof headSha !== 'string' || !/^[a-f0-9]{40}$/i.test(headSha) ||
    !connection || !Array.isArray(connection.nodes)
  ) return null;

  let complete = connection.pageInfo?.hasNextPage === false;
  const reviews = connection.nodes.slice(0, 100).flatMap((review) => {
    if (review.comments && review.comments.pageInfo?.hasNextPage !== false) complete = false;
    if (
      typeof review.id !== 'string' ||
      typeof review.state !== 'string' ||
      typeof review.submittedAt !== 'string' ||
      typeof review.commit?.oid !== 'string'
    ) return [];

    const actorKind = review.isCopilotCodeReview === true
      ? 'copilot'
      : review.author?.__typename === 'User'
        ? 'human'
        : 'unknown';
    const commentAttributions = Array.isArray(review.comments?.nodes)
      ? review.comments.nodes.slice(0, 100).flatMap((comment) => {
          if (comment.isCopilotCodeReview !== true || typeof comment.id !== 'string') return [];
          const sourceKinds = Array.isArray(comment.copilotCodeReviewSources)
            ? comment.copilotCodeReviewSources.flatMap((source) =>
                typeof source?.kind === 'string' ? [source.kind.toLowerCase()] : [])
            : [];
          return sourceKinds.length ? [{ commentId: comment.id, sourceKinds }] : [];
        })
      : [];

    const normalized = normalizeReviewProvenance({
      reviewId: review.id,
      pullRequestNumber,
      reviewedCommitSha: review.commit.oid,
      submittedAt: review.submittedAt,
      state: review.state,
      actorKind,
      effortLevel: typeof review.copilotCodeReviewEffort === 'string'
        ? review.copilotCodeReviewEffort.toLowerCase()
        : null,
      commentAttributions,
    });
    return normalized ? [normalized] : [];
  });

  const copilotReviewCount = reviews.filter((review) => review.actorKind === 'copilot').length;
  return {
    schemaVersion: 'ryanai.github-review-provenance-snapshot/v1',
    pullRequestNumber,
    headSha: headSha.toLowerCase(),
    complete,
    returnedReviewCount: reviews.length,
    reportedReviewCount: Number.isSafeInteger(connection.totalCount)
      ? Number(connection.totalCount)
      : null,
    copilotReviewCount,
    exactHeadHumanApprovalCount: reviews.filter((review) =>
      isEligibleHumanApproval(review, headSha)).length,
    reviews,
  };
}
