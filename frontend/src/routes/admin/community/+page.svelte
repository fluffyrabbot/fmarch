<script>
  import { buildCommunityStewardshipView } from "./community-stewardship.mjs";
  export let data;
  export let form;
  $: view = buildCommunityStewardshipView(data.snapshot);
</script>

<svelte:head><title>Community stewardship · Admin</title></svelte:head>

<main class="stewardship" data-testid="community-stewardship">
  <header class="stewardship__header">
    <div><p class="fm-eyebrow">Admin · Closed community</p><h1>Membership stewardship</h1><p>Inspect invite provenance, intervene on memberships, and monitor privacy-safe invitation pressure.</p></div>
    <a class="fm-touch-button fm-touch-button--secondary" href="/admin">Back to operations</a>
  </header>

  {#if form?.message}<p class="fm-well" data-state={form.state} role="status">{form.message}</p>{/if}

  <section class="metrics" aria-label="Community metrics">
    <article class="fm-panel"><strong>{view.metrics.active}</strong><span>active</span></article>
    <article class="fm-panel"><strong>{view.metrics.suspended}</strong><span>suspended</span></article>
    <article class="fm-panel"><strong>{view.metrics.pending}</strong><span>pending invites</span></article>
    <article class="fm-panel"><strong>{view.metrics.acceptedThisWeek}</strong><span>accepted / 7 days</span></article>
    <article class="fm-panel"><strong>{view.metrics.revokedThisWeek}</strong><span>revoked / 7 days</span></article>
  </section>

  <section class="section">
    <header><div><p class="fm-eyebrow">Provenance forest</p><h2>Membership chain</h2></div><span>Quota: {view.quotaLabel}</span></header>
    {#if view.empty}<div class="fm-panel"><p>No memberships found.</p></div>{:else}
      <div class="member-list">
        {#each view.memberships as member}
          <article class={`fm-panel member ${member.depthClass}`} data-status={member.status} data-testid={`community-member-${member.id}`}>
            <div class="member__identity"><span class="member__branch" aria-hidden="true">↳</span><div><p class="fm-eyebrow">{member.sponsorId ? `Sponsored by ${member.sponsorId.slice(0, 8)}` : "Founder root"}</p><h3>{member.shortId}</h3></div></div>
            <dl><div><dt>Status</dt><dd>{member.status}</dd></div><div><dt>Invites</dt><dd>{member.openInvitations} open · {member.recentInvitations} recent</dd></div><div><dt>Pressure</dt><dd>{member.quotaState.replaceAll("_", " ")}</dd></div></dl>
            {#if member.canSuspend}
              <form method="POST" action="?/suspend"><input type="hidden" name="membershipId" value={member.id} /><label>Reason<input name="reason" maxlength="280" required /></label><button class="fm-touch-button" type="submit">Suspend</button></form>
            {:else if member.canRestore}
              <form method="POST" action="?/restore"><input type="hidden" name="membershipId" value={member.id} /><button class="fm-touch-button" type="submit">Restore</button></form>
            {/if}
          </article>
        {/each}
      </div>
    {/if}
  </section>

  <section class="section">
    <header><div><p class="fm-eyebrow">Pending invitations</p><h2>Credential-safe queue</h2></div><span>Recipient is represented only by a keyed fingerprint.</span></header>
    {#if view.pendingInvitations.length === 0}<div class="fm-panel"><p>No invitations are pending.</p></div>{:else}
      <div class="invite-list">
        {#each view.pendingInvitations as invitation}
          <article class="fm-panel invite" data-testid={`community-invitation-${invitation.id}`}><div><p class="fm-eyebrow">Target {invitation.targetFingerprint}</p><h3>{invitation.shortId}</h3><p>Sponsored by {invitation.sponsorId.slice(0, 8)} · {invitation.deliveryStatus} via {invitation.providerId}</p></div><form method="POST" action="?/revoke"><input type="hidden" name="invitationId" value={invitation.id} /><button class="fm-touch-button" type="submit">Revoke</button></form></article>
        {/each}
      </div>
    {/if}
  </section>
</main>

<style>
  .stewardship { display: grid; gap: 24px; margin-inline: auto; max-inline-size: 1120px; padding: clamp(20px, 4vw, 48px); }
  .stewardship__header, .section > header, .invite { align-items: start; display: flex; gap: 18px; justify-content: space-between; }
  h1, h2, h3, p { margin: 0; }.stewardship__header > div, .section > header > div { display: grid; gap: 7px; }
  .metrics { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(135px, 1fr)); }.metrics article { display: grid; gap: 4px; }.metrics strong { font-size: 28px; }.metrics span, .section > header > span { color: var(--fm-ink-muted); font-size: 12px; }
  .section, .member-list, .invite-list { display: grid; gap: 14px; }.member { display: grid; gap: 14px; }.member--depth-1 { margin-inline-start: 22px; }.member--depth-2 { margin-inline-start: 44px; }.member--depth-3 { margin-inline-start: 66px; }.member--depth-4 { margin-inline-start: 88px; }.member--depth-5 { margin-inline-start: 110px; }.member--depth-6 { margin-inline-start: 132px; }.member__identity { align-items: center; display: flex; gap: 10px; }.member__branch { color: var(--fm-ink-muted); }.member h3, .invite h3 { font-family: monospace; }
  dl { display: flex; flex-wrap: wrap; gap: 16px; margin: 0; }dl div { display: grid; gap: 3px; }dt { color: var(--fm-ink-muted); font-size: 11px; font-weight: 800; }dd { margin: 0; }
  form { align-items: end; display: flex; flex-wrap: wrap; gap: 10px; }label { display: grid; gap: 4px; }input { min-block-size: 42px; min-inline-size: min(280px, 70vw); }
  .invite > div { display: grid; gap: 5px; }.invite p:last-child { color: var(--fm-ink-muted); font-size: 13px; }
  @media (max-width: 650px) { .stewardship__header, .section > header, .invite { display: grid; }.member--depth-1 { margin-inline-start: 8px; }.member--depth-2 { margin-inline-start: 16px; }.member--depth-3 { margin-inline-start: 24px; }.member--depth-4, .member--depth-5, .member--depth-6 { margin-inline-start: 32px; } }
</style>
