import { useState } from 'react'
import { memberById, useGame } from '../store'
import { Prose, duration } from '../util'

export default function ReportTab() {
  const snap = useGame((s) => s.snap)!
  if (snap.result) return <Debrief />
  const acc = snap.case.accusation
  if (!acc.open) {
    return (
      <div className="report report-locked">
        <h2>The report</h2>
        <p>
          When you're ready, your agency files one report with {acc.questions.length} answers. It isn't ready to file
          yet. Keep investigating; the report opens once the case has come far enough for an answer to be fair.
        </p>
        <p className="muted small">You'll have {snap.team.maxAttempts} chances to get it right.</p>
      </div>
    )
  }
  return <ReportForm />
}

function ReportForm() {
  const snap = useGame((s) => s.snap)!
  const busy = useGame((s) => s.busy)
  const { setAnswers, sign, accuse } = useGame.getState()
  const [confirming, setConfirming] = useState(false)
  const acc = snap.case.accusation
  const d = snap.draft
  const left = snap.team.maxAttempts - snap.team.attemptsUsed
  const allAnswered = acc.questions.every((q) => d.answers[q.id])
  const iSigned = d.signed.includes(snap.you)
  const unsignedOnline = snap.members.filter((m) => m.online && m.id !== snap.you && !d.signed.includes(m.id))
  const ready = allAnswered && unsignedOnline.length === 0
  const people = [...snap.game.people].sort((a, b) => a.name.localeCompare(b.name))
  const updatedBy = memberById(snap, d.updatedBy)

  return (
    <div className="report">
      <h2>Report to the client</h2>
      <Prose text={acc.intro} />

      <ol className="report-questions">
        {acc.questions.map((q) => (
          <li key={q.id}>
            <label>
              <span className="report-prompt">
                {q.prompt}
                {!q.required && <span className="muted small"> (bonus)</span>}
              </span>
              <select
                className="select"
                value={d.answers[q.id] ?? ''}
                onChange={(e) => setAnswers({ ...useGame.getState().snap!.draft.answers, [q.id]: e.target.value })}
              >
                <option value="">Choose…</option>
                {q.kind === 'person'
                  ? people.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}, {p.role}
                      </option>
                    ))
                  : q.options?.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
              </select>
            </label>
          </li>
        ))}
      </ol>
      {updatedBy && <p className="muted small">Last changed by {updatedBy.displayName}. Any change clears all signatures.</p>}

      <section className="signatures">
        <h4>Signatures</h4>
        <ul>
          {snap.members.map((m) => (
            <li key={m.id}>
              <span style={{ color: m.color }}>{m.displayName}</span>
              <span className="muted small">
                {d.signed.includes(m.id) ? 'signed' : m.online ? 'not signed' : 'offline, not needed'}
              </span>
            </li>
          ))}
        </ul>
        <button className="btn small" disabled={!allAnswered} onClick={() => sign(!iSigned)}>
          {iSigned ? 'Take back my signature' : 'Sign the report'}
        </button>
      </section>

      <div className="report-file">
        {!confirming ? (
          <button className="btn stamp" disabled={!ready || busy} onClick={() => setConfirming(true)}>
            File the report
          </button>
        ) : (
          <div className="confirm">
            <p>
              File it? You have {left} {left === 1 ? 'attempt' : 'attempts'} left
              {left === 1 ? ', and this is the last one' : ''}.
            </p>
            <div className="row">
              <button className="btn ghost" onClick={() => setConfirming(false)}>
                Not yet
              </button>
              <button
                className="btn stamp"
                disabled={busy}
                onClick={async () => {
                  await accuse()
                  setConfirming(false)
                }}
              >
                File it
              </button>
            </div>
          </div>
        )}
        {!allAnswered && <p className="muted small">Answer every question first.</p>}
        {allAnswered && unsignedOnline.length > 0 && (
          <p className="muted small">Waiting for {unsignedOnline.map((m) => m.displayName).join(', ')} to sign.</p>
        )}
      </div>

      {snap.attempts.length > 0 && (
        <section className="attempts">
          <h4>Earlier reports</h4>
          <ul>
            {snap.attempts.map((a) => (
              <li key={a.attempt}>
                Report {a.attempt}: {a.requiredCorrect} of {a.requiredTotal} key answers were right.
              </li>
            ))}
          </ul>
          <p className="muted small">The client never says which ones. Go back to the evidence.</p>
        </section>
      )}
    </div>
  )
}

function Debrief() {
  const snap = useGame((s) => s.snap)!
  const r = snap.result!
  return (
    <div className="debrief">
      <p className={`debrief-stamp ${r.status}`}>{r.status === 'solved' ? 'Case closed' : 'Unsolved'}</p>
      <h2>{r.rank}</h2>
      {r.status === 'solved' && (
        <p className="debrief-score">
          <strong>{r.score}</strong> <span className="muted">out of 100</span>
        </p>
      )}
      <dl className="debrief-facts">
        <div>
          <dt>Answers</dt>
          <dd>
            {r.points} / {r.maxPoints} points
          </dd>
        </div>
        <div>
          <dt>Time on the case</dt>
          <dd>{duration(r.active)}</dd>
        </div>
        {r.par > 0 && (
          <div>
            <dt>A sharp agency</dt>
            <dd>{duration(r.par)}</dd>
          </div>
        )}
        <div>
          <dt>Reports filed</dt>
          <dd>{r.attempts}</dd>
        </div>
      </dl>
      <table className="debrief-table">
        <tbody>
          {r.questions.map((q) => (
            <tr key={q.id} className={q.correct ? 'right' : 'wrong'}>
              <th>{q.prompt}</th>
              <td>
                {q.given}
                {!q.correct && <div className="debrief-answer">The truth: {q.answer}</div>}
              </td>
              <td className="debrief-mark">{q.correct ? 'Right' : 'Wrong'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {r.epilogue && (
        <section className="epilogue">
          <h3>What really happened</h3>
          <Prose text={r.epilogue} />
        </section>
      )}
    </div>
  )
}
