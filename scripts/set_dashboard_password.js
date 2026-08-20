#!/usr/bin/env node

require('../src/env');

const { createClient } = require('@supabase/supabase-js');
const config = require('../src/config');

function usage() {
  console.log('Usage: npm run set:dashboard-password -- <email>');
  console.log('The password is requested privately and is never written to disk.');
}

function readHidden(label) {
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    const output = process.stdout;
    if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== 'function') {
      reject(new Error('Run this command in an interactive terminal so the password can stay hidden.'));
      return;
    }

    let value = '';
    const wasRaw = input.isRaw;

    const cleanup = () => {
      input.off('data', onData);
      input.setRawMode(Boolean(wasRaw));
      input.pause();
    };

    const finish = () => {
      cleanup();
      output.write('\n');
      resolve(value);
    };

    const cancel = () => {
      cleanup();
      output.write('\n');
      reject(new Error('Password update cancelled.'));
    };

    const onData = (chunk) => {
      for (const character of String(chunk)) {
        if (character === '\u0003') return cancel();
        if (character === '\r' || character === '\n') return finish();
        if (character === '\u007f' || character === '\b') {
          value = Array.from(value).slice(0, -1).join('');
        } else if (character >= ' ') {
          value += character;
        }
      }
    };

    output.write(label);
    input.setEncoding('utf8');
    input.setRawMode(true);
    input.resume();
    input.on('data', onData);
  });
}

async function findUserByEmail(supabase, email) {
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const user = data.users.find(candidate => candidate.email?.toLowerCase() === email);
    if (user) return user;
    if (data.users.length < 1000) break;
  }
  return null;
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    usage();
    return;
  }

  const email = String(process.argv[2] || '').trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    usage();
    throw new Error('Provide the dashboard user email address.');
  }
  if (!config.supabase.url || !config.supabase.key || !config.supabase.isServerKey) {
    throw new Error('A valid SUPABASE_URL and server-side service key are required in .env.local.');
  }

  let password = await readHidden('New password (12+ characters): ');
  let confirmation = await readHidden('Confirm new password: ');
  if (password.length < 12) throw new Error('Use a password with at least 12 characters.');
  if (password !== confirmation) throw new Error('The passwords do not match. Nothing was changed.');

  const supabase = createClient(config.supabase.url, config.supabase.key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const user = await findUserByEmail(supabase, email);
  if (!user) throw new Error(`No Supabase Auth user exists for ${email}.`);

  const { error } = await supabase.auth.admin.updateUserById(user.id, { password });
  password = '';
  confirmation = '';
  if (error) throw error;

  const { data: membership } = await supabase
    .from('organization_members')
    .select('organization_id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();
  if (membership?.organization_id) {
    const { error: auditError } = await supabase.from('audit_events').insert({
      organization_id: membership.organization_id,
      event_type: 'auth.password.admin_set',
      target_type: 'auth_user',
      target_id: user.id,
      metadata: { channel: 'local_admin_utility' },
    });
    if (auditError) console.warn('Password changed, but the audit event could not be recorded.');
  }

  console.log(`Password updated for ${email}. You can now sign in to EpsiFlow.`);
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});
