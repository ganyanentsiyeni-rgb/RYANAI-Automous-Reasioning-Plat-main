export const GITHUB_PR_REVIEW_REPOSITORY =
  'ganyanentsiyeni-rgb/RYANAI-Automous-Reasioning-Plat-main';

type ApprovalDecision = 'approve' | 'reject';

interface ApprovalRow {
  id: string;
  pull_request_number: number;
  expected_head_sha: string;
  status: 'approved' | 'rejected';
}

interface ApprovalPrisma {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
}

function normalizePhone(value: string): string {
  return value.trim().replace(/^whatsapp:/i, '').replace(/[^+\d]/g, '');
}

/**
 * Records a one-time GitHub PR review decision from the trusted Twilio route.
 * The route must call this only after Twilio signature validation, configured
 * owner-number matching, and resolving the configured owner Supabase user ID.
 * The database independently re-checks the owner's verified phone destination.
 * This function records consent only; it never calls GitHub.
 */
export async function recordOwnerGitHubPrReviewDecision(
  prisma: ApprovalPrisma,
  input: {
    ownerUserId: string;
    approvalId: string;
    expectedHeadSha: string;
    inboundMessageSid: string;
    decision: ApprovalDecision;
  },
  env: NodeJS.ProcessEnv = process.env,
): Promise<ApprovalRow> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.approvalId) ||
      !/^[a-f0-9]{40}$/i.test(input.expectedHeadSha) ||
      !/^SM[A-Za-z0-9]{8,126}$/.test(input.inboundMessageSid) ||
      !input.ownerUserId || (input.decision !== 'approve' && input.decision !== 'reject')) {
    throw new Error('invalid_github_pr_review_approval');
  }

  const ownerPhone = env.RYANAI_OWNER_PHONE?.trim() ?? '';
  const normalizedOwnerPhone = normalizePhone(ownerPhone);
  if (!/^\+[1-9]\d{7,14}$/.test(normalizedOwnerPhone)) {
    throw new Error('inbound_owner_phone_not_configured');
  }

  // No independent Gen-X authorization adapter is wired for this approval path.
  // Never manufacture owner authorization by passing hardcoded true flags.
  // Rejections remain available; approvals fail closed until verified authorization exists.
  if (input.decision === 'approve') {
    throw new Error('genx_authorization_unavailable');
  }

  const status = input.decision === 'approve' ? 'approved' : 'rejected';
  const rows = await prisma.$queryRawUnsafe<ApprovalRow[]>(
    `UPDATE public.github_pr_review_approvals AS approval
        SET status = $6,
            approved_at = CASE WHEN $6 = 'approved' THEN NOW() ELSE NULL END,
            consumed_at = CASE WHEN $6 = 'approved' THEN NOW() ELSE NULL END,
            inbound_message_sid = $4,
            updated_at = NOW()
      WHERE approval.id = $1::uuid
        AND approval.owner_user_id = $2::uuid
        AND approval.repository_full_name = $3
        AND approval.expected_head_sha = $5
        AND approval.status = 'pending'
        AND approval.expires_at > NOW()
        AND approval.inbound_message_sid IS NULL
        AND EXISTS (
          SELECT 1
            FROM public.comms_verified_destinations AS destination
           WHERE destination.owner_user_id = approval.owner_user_id
             AND destination.channel = 'phone'
             AND destination.normalized_address = $7
             AND destination.revoked_at IS NULL
             AND destination.verified_at <= NOW()
        )
      RETURNING approval.id, approval.pull_request_number,
                approval.expected_head_sha, approval.status`,
    input.approvalId,
    input.ownerUserId,
    GITHUB_PR_REVIEW_REPOSITORY,
    input.inboundMessageSid,
    input.expectedHeadSha.toLowerCase(),
    status,
    normalizedOwnerPhone,
  );
  if (rows.length !== 1) throw new Error('github_pr_review_approval_not_found_expired_or_already_used');
  return rows[0];
}
