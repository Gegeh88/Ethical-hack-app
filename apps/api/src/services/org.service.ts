import { sql } from '../lib/db.js';
import { ForbiddenError } from '../lib/errors.js';

interface CreateOrgResult {
  org: {
    id: string;
    name: string;
    billing_email: string;
    created_at: string;
    updated_at: string;
  };
  subscription: {
    id: string;
    organization_id: string;
    tier: string;
    status: string;
    created_at: string;
    updated_at: string;
  };
}

export async function createOrganization(
  userId: string,
  name: string,
  billingEmail: string,
): Promise<CreateOrgResult> {
  return await sql.begin(async (tx) => {
    // 1. Create the organization
    const [org] = await tx`
      INSERT INTO organizations (name, billing_email)
      VALUES (${name}, ${billingEmail})
      RETURNING id, name, billing_email, created_at, updated_at
    `;

    if (!org) {
      throw new Error('Failed to create organization');
    }

    // 2. Create the free-tier subscription
    const [subscription] = await tx`
      INSERT INTO subscriptions (organization_id, tier, status)
      VALUES (${org.id}, 'free', 'active')
      RETURNING id, organization_id, tier, status, created_at, updated_at
    `;

    if (!subscription) {
      throw new Error('Failed to create subscription');
    }

    // 3. Assign user as owner of the new org
    //    Only succeeds if the user does NOT already belong to an org
    const updateResult = await tx`
      UPDATE app_users
      SET organization_id = ${org.id}, role = 'owner', updated_at = now()
      WHERE id = ${userId} AND organization_id IS NULL
    `;

    if (updateResult.count === 0) {
      throw new ForbiddenError('User already belongs to an organization');
    }

    return {
      org: org as unknown as CreateOrgResult['org'],
      subscription: subscription as unknown as CreateOrgResult['subscription'],
    };
  });
}
