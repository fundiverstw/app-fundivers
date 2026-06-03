import { ok, badRequest, forbidden, serverError } from 'wix-http-functions';
import wixSecretsBackend from 'wix-secrets-backend';
import {
  upsertOne,
  deleteOne,
  syncFromSupabase,
  syncOne,
  isSyncTable,
  SYNC_TABLES,
} from 'backend/syncFromSupabase.jsw';

async function checkToken(request) {
  let expectedToken;
  try {
    expectedToken = await wixSecretsBackend.getSecret('SUPABASE_WEBHOOK_TOKEN');
  } catch (e) {
    return serverError({ body: 'webhook token secret not configured' });
  }
  if (request.headers['x-sync-token'] !== expectedToken) {
    return forbidden({ body: 'unauthorized' });
  }
  return null;
}

export async function post_syncSupabase(request) {
  const denied = await checkToken(request);
  if (denied) return denied;

  const table = request.query && request.query.table;
  try {
    let result;
    if (!table) {
      result = await syncFromSupabase();
    } else if (isSyncTable(table)) {
      result = await syncOne(table);
    } else {
      return badRequest({ body: `unsupported table: ${table}. allowed: ${SYNC_TABLES.join(', ')}` });
    }
    return ok({
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result),
    });
  } catch (e) {
    return serverError({ body: `full sync failed: ${e.message}` });
  }
}

// Supabase Database Webhook target.
// URL: https://fundiverstw.com/_functions/supabaseWebhook
//
// Configure the webhook to send a custom header `x-sync-token: <secret>`,
// matching the Wix secret SUPABASE_WEBHOOK_TOKEN.
export async function post_supabaseWebhook(request) {
  const denied = await checkToken(request);
  if (denied) return denied;

  let payload;
  try {
    payload = await request.body.json();
  } catch (e) {
    return badRequest({ body: 'invalid json body' });
  }

  const { type, table, record, old_record } = payload || {};
  if (!isSyncTable(table)) {
    return badRequest({ body: `unsupported table: ${table}` });
  }

  try {
    if (type === 'INSERT' || type === 'UPDATE') {
      if (!record) return badRequest({ body: 'missing record' });
      const saved = await upsertOne(table, record);
      return ok({
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ table, type, _id: saved._id }),
      });
    }
    if (type === 'DELETE') {
      const id = (old_record && (old_record._id ?? old_record.id))
              ?? (record    && (record._id    ?? record.id));
      if (id == null) return badRequest({ body: 'missing id for delete' });
      await deleteOne(table, id);
      return ok({
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ table, type, _id: String(id) }),
      });
    }
    return badRequest({ body: `unsupported type: ${type}` });
  } catch (e) {
    return serverError({ body: `sync failed: ${e.message}` });
  }
}
