from pathlib import Path


def replace(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"Expected block not found in {path}: {old[:120]!r}")
    file.write_text(text.replace(old, new, 1), encoding="utf-8")


replace(
    "packages/database/src/beta-telemetry.ts",
    """        AND member.status IN ('active','completed')
        AND wave.status IN ('active','completed')""",
    """        AND member.status IN ('active','completed','paused')
        AND wave.status IN ('active','completed','paused')"""
)
replace(
    "packages/database/src/beta-telemetry.ts",
    """      WHERE status IN ('active','completed','paused') ORDER BY created_at""",
    """      WHERE status IN ('active','completed','paused','rolled-back') ORDER BY created_at"""
)
replace(
    "packages/database/src/beta-telemetry.ts",
    """        WHERE wave_id=${waveId}::uuid AND activated_at IS NOT NULL""",
    """        WHERE wave_id=${waveId}::uuid
          AND activated_at IS NOT NULL
          AND activated_at<${metricDate}::date+interval '1 day'"""
)
replace(
    "packages/database/src/beta-telemetry.ts",
    """      retentionD1Percent: retentionD1,
      retentionD7Percent: retentionD7,""",
    """      retentionD1Percent: retentionD1,
      retentionD7Percent: retentionD7,
      retentionD1EligibleUsers: eligibleD1,
      retentionD7EligibleUsers: eligibleD7,"""
)
replace(
    "packages/database/src/beta-telemetry.ts",
    """          computedBy: actorId,reasons: health.reasons,sampleReady: health.sampleReady""",
    """          computedBy: actorId,reasons: health.reasons,sampleReady: health.sampleReady,
          eligibleD1,eligibleD7"""
)
replace(
    "packages/database/src/beta-telemetry-rules.ts",
    """  retentionD1Percent: number;
  retentionD7Percent: number;
  conversionPercent: number;""",
    """  retentionD1Percent: number;
  retentionD7Percent: number;
  retentionD1EligibleUsers: number;
  retentionD7EligibleUsers: number;
  conversionPercent: number;"""
)
replace(
    "packages/database/src/beta-telemetry-rules.ts",
    """  const sampleReady = input.activatedUsers >= 25;
""",
    """  const sampleReady = input.activatedUsers >= 25
    && input.retentionD1EligibleUsers >= 25
    && input.retentionD7EligibleUsers >= 25;
"""
)
replace(
    "packages/database/src/beta-telemetry-rules.ts",
    """  if (!sampleReady) reasons.push("Amostra inferior a 25 usuários ativados.");""",
    """  if (input.activatedUsers < 25) {
    reasons.push("Amostra inferior a 25 usuários ativados.");
  }
  if (input.retentionD1EligibleUsers < 25) {
    reasons.push("Coorte D1 ainda não possui 25 usuários elegíveis.");
  }
  if (input.retentionD7EligibleUsers < 25) {
    reasons.push("Coorte D7 ainda não possui 25 usuários elegíveis.");
  }"""
)
replace(
    "packages/database/src/beta-telemetry-rules.ts",
    """  if (input.retentionD7Percent < 25) {
    reasons.push(`Retenção D7 abaixo de 25%: ${input.retentionD7Percent.toFixed(2)}%.`);
  }""",
    """  if (input.retentionD7EligibleUsers >= 25 && input.retentionD7Percent < 25) {
    reasons.push(`Retenção D7 abaixo de 25%: ${input.retentionD7Percent.toFixed(2)}%.`);
  }"""
)
replace(
    "packages/database/src/beta-telemetry-rules.ts",
    """  const recommendation: BetaRecommendation =
    input.criticalFeedback > 0
      || input.errorRatePercent > 5
      || healthScore < 55
      ? "reduce"
      : sampleReady
        && healthScore >= 80""",
    """  const recommendation: BetaRecommendation =
    input.criticalFeedback > 0
      || input.errorRatePercent > 5
      || (sampleReady && healthScore < 55)
      ? "reduce"
      : sampleReady
        && healthScore >= 80"""
)

tests = Path("packages/database/src/beta-telemetry-rules.test.ts")
test_text = tests.read_text(encoding="utf-8")
test_text = test_text.replace(
    """    retentionD1Percent: 82,
    retentionD7Percent: 72,""",
    """    retentionD1Percent: 82,
    retentionD7Percent: 72,
    retentionD1EligibleUsers: 100,
    retentionD7EligibleUsers: 100,"""
)
test_text = test_text.replace(
    """    retentionD1Percent: 55,
    retentionD7Percent: 30,""",
    """    retentionD1Percent: 55,
    retentionD7Percent: 30,
    retentionD1EligibleUsers: 100,
    retentionD7EligibleUsers: 100,"""
)
marker = """test("bloqueia prontidão comunitária com feedback crítico", () => {"""
immature_test = """test("mantém a onda quando as coortes de retenção ainda não amadureceram", () => {
  const result = calculateBetaHealth({
    activatedUsers: 25,
    activeUsers: 20,
    retentionD1Percent: 0,
    retentionD7Percent: 0,
    retentionD1EligibleUsers: 0,
    retentionD7EligibleUsers: 0,
    conversionPercent: 80,
    errorRatePercent: 0.2,
    averageFeedbackScore: 4.5,
    criticalFeedback: 0,
    economyStabilityScore: 95
  });
  assert.equal(result.sampleReady,false);
  assert.equal(result.recommendation,"hold");
});

"""
if immature_test not in test_text:
    if marker not in test_text:
        raise SystemExit("Test insertion marker not found")
    test_text = test_text.replace(marker, immature_test + marker, 1)
tests.write_text(test_text, encoding="utf-8")

replace(
    "apps/worker/src/worker.ts",
    """  const today = new Date().toISOString().slice(0,10);
  const telemetryWavesComputed = today === lastTelemetryDate
    ? 0
    : await betaTelemetry.recomputeDailyMetrics("worker");
  if (telemetryWavesComputed >= 0) lastTelemetryDate = today;""",
    """  const completedDate = new Date(Date.now()-86_400_000).toISOString().slice(0,10);
  const telemetryWavesComputed = completedDate === lastTelemetryDate
    ? 0
    : await betaTelemetry.recomputeDailyMetrics("worker",completedDate);
  if (telemetryWavesComputed >= 0) lastTelemetryDate = completedDate;"""
)
replace(
    "packages/database/src/beta-community.ts",
    """          announcement.audience IN ('all','beta')
          OR (announcement.audience='wave' AND EXISTS (
            SELECT 1 FROM beta_wave_members member
            WHERE member.wave_id=announcement.wave_id
              AND member.user_id=${userId}::uuid
          ))""",
    """          announcement.audience='all'
          OR (announcement.audience='beta' AND EXISTS (
            SELECT 1 FROM beta_wave_members member
            WHERE member.user_id=${userId}::uuid
              AND member.status IN ('active','paused','completed')
          ))
          OR (announcement.audience='wave' AND EXISTS (
            SELECT 1 FROM beta_wave_members member
            WHERE member.wave_id=announcement.wave_id
              AND member.user_id=${userId}::uuid
              AND member.status IN ('active','paused','completed')
          ))"""
)
replace(
    "packages/database/src/beta-community.ts",
    """  async processScheduledAnnouncements(): Promise<number> {
    const published = await this.sql`
      UPDATE community_announcements SET
        status='published',published_at=now(),updated_at=now()
      WHERE status='scheduled' AND publish_at<=now()
        AND (expires_at IS NULL OR expires_at>now())
      RETURNING id
    `;
    const expired = await this.sql`
      UPDATE community_announcements SET status='expired',updated_at=now()
      WHERE status='published' AND expires_at IS NOT NULL AND expires_at<=now()
      RETURNING id
    `;
    if (published.length || expired.length) await this.syncCommunityGate();
    return published.length;
  }""",
    """  async processScheduledAnnouncements(): Promise<number> {
    const published = await this.sql.begin(async (tx) => {
      const rows = await tx`
        UPDATE community_announcements SET
          status='published',published_at=now(),updated_at=now()
        WHERE status='scheduled' AND publish_at<=now()
          AND (expires_at IS NULL OR expires_at>now())
        RETURNING id,title,audience,wave_id
      `;
      for (const row of rows) {
        await this.outbox(tx, String(row.id), "community.announcement.published", {
          title: row.title,
          audience: row.audience,
          waveId: row.wave_id
        });
      }
      await tx`
        UPDATE community_announcements SET status='expired',updated_at=now()
        WHERE status IN ('scheduled','published')
          AND expires_at IS NOT NULL AND expires_at<=now()
      `;
      return rows;
    });
    await this.syncCommunityGate();
    return published.length;
  }"""
)
replace(
    "apps/web/src/app/beta-insights/page.tsx",
    """  const isAdmin = identity?.roles.includes("platform-admin")
    || identity?.roles.includes("municipal-admin");""",
    """  const isPlatformAdmin = identity?.roles.includes("platform-admin") ?? false;
  const isAdmin = isPlatformAdmin
    || identity?.roles.includes("municipal-admin");"""
)
replace(
    "apps/web/src/app/beta-insights/page.tsx",
    """          <button
            className={styles.button}
            type="button"
            onClick={() => void recompute()}
            disabled={busy}
          >
            Recalcular hoje
          </button>""",
    """          {isPlatformAdmin ? (
            <button
              className={styles.button}
              type="button"
              onClick={() => void recompute()}
              disabled={busy}
            >
              Recalcular dia concluído
            </button>
          ) : (
            <p>Recomputação disponível somente para administração da plataforma.</p>
          )}"""
)
replace(
    "apps/web/src/app/beta-insights/page.tsx",
    """          <form className={styles.form} onSubmit={createAnnouncement}>
            <label>
              Título
              <input
                className={styles.input}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            <label>
              Mensagem
              <textarea
                className={styles.textarea}
                value={body}
                onChange={(event) => setBody(event.target.value)}
              />
            </label>
            <button className={styles.button} disabled={busy}>Publicar</button>
          </form>""",
    """          {isPlatformAdmin ? (
            <form className={styles.form} onSubmit={createAnnouncement}>
              <label>
                Título
                <input
                  className={styles.input}
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </label>
              <label>
                Mensagem
                <textarea
                  className={styles.textarea}
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                />
              </label>
              <button className={styles.button} disabled={busy}>Publicar</button>
            </form>
          ) : (
            <p>Publicação disponível somente para administração da plataforma.</p>
          )}"""
)
