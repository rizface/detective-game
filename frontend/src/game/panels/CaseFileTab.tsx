import { useGame } from '../store'
import { Prose, duration } from '../util'

export default function CaseFileTab() {
  const snap = useGame((s) => s.snap)!
  const { clock } = snap.game
  const chapters = [...snap.game.chapters].reverse()
  return (
    <div className="casefile">
      <section className="casefile-status">
        <div>
          <span className="muted small">Time on the case</span>
          <strong>{duration(clock.active)}</strong>
        </div>
        <div>
          <span className="muted small">Places visited</span>
          <strong>{snap.game.locations.filter((l) => l.visited).length}</strong>
        </div>
        <div>
          <span className="muted small">Evidence</span>
          <strong>{snap.game.documents.length}</strong>
        </div>
        <div>
          <span className="muted small">Reports left</span>
          <strong>{snap.team.maxAttempts - snap.team.attemptsUsed}</strong>
        </div>
      </section>

      {chapters.map((ch) => {
        const n = snap.game.chapters.indexOf(ch) + 1
        return (
          <section key={ch.id} className="casefile-chapter">
            <p className="chapter-mark">Chapter {n}</p>
            <h2>{ch.title}</h2>
            <Prose text={ch.brief} />
            {ch.objectives && ch.objectives.length > 0 && (
              <>
                <h4>Open questions</h4>
                <ul className="objectives">
                  {ch.objectives.map((o, i) => (
                    <li key={i}>{o}</li>
                  ))}
                </ul>
              </>
            )}
          </section>
        )
      })}

      <section className="casefile-chapter">
        <p className="chapter-mark">How it began</p>
        <h2>{snap.case.title}</h2>
        <Prose text={snap.case.intro} />
      </section>
    </div>
  )
}
