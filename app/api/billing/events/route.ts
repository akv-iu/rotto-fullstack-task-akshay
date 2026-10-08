import { processStripeWebhook } from '@/lib/server/billing';
import { json, route } from '@/lib/server/http';

// No recruiter token: Stripe calls this. The raw bytes are verified exactly as sent, never decoded or re-serialised first.
export const POST = route(async (req) => {
  const { status, body } = await processStripeWebhook(Buffer.from(await req.arrayBuffer()), req.headers.get('stripe-signature'));
  return json(body, status);
});
