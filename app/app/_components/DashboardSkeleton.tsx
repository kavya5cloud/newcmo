"use client";

// The dashboard, before it has anything to show.
//
// Analysis takes ten to twenty seconds: the profile has to come back before the feed can be
// asked for, because the feed prompt needs the company's name. For that whole time the app
// showed the onboarding screen with a five-line progress list, and the product a person paid
// for did not exist yet on screen.
//
// A progress list answers "is it working". It does not answer "what am I getting", and that
// is the question someone has ten seconds after pasting a URL. Showing the real layout with
// its content greyed out answers both: the shape of the product arrives immediately, the
// live log says it is moving, and nothing has to be re-learned when the data lands because
// it lands in the boxes already on screen.
//
// Deliberately a separate component rather than the real dashboard with null-guards
// everywhere. The dashboard reads profile, feed, competitors and chat across several hundred
// lines; making every one of them tolerate absence to serve a ten-second window is how a
// working screen acquires a second, worse mode nobody tests.

const BAR = (w: string, h = 12) => ({ width: w, height: h });

/** One grey block. Width as a percentage string so rows look uneven, like real text. */
function Bar({ w, h }: { w: string; h?: number }) {
  return <span className="skl" style={BAR(w, h)} aria-hidden="true" />;
}

function Column({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="col">
      <div className="col-head"><span className="ct">{title}</span></div>
      <div className="col-body">{children}</div>
    </div>
  );
}

export default function DashboardSkeleton({ steps, progress }: { steps: string[]; progress: number }) {
  return (
    <div className="appshell skl-shell" aria-busy="true">
      <div className="topbar">
        <div className="tb-l">
          <span className="app-wordmark">Populr.</span>
          <span className="sep">·</span>
          <span className="mono" style={{ fontSize: 11, color: "var(--dim)" }}>reading your site…</span>
        </div>
      </div>

      {/* The one live thing on screen. Everything else is a placeholder, so this carries the
          whole burden of proving the app has not hung — which is why it stays real rather
          than becoming another grey bar. */}
      <div className="termstrip">
        <div className="tlog">
          {steps.map((s, i) => (
            <div className={"pl" + (progress > i ? " done" : "")} key={s}>
              {progress > i ? "● " : progress === i ? "◐ " : "○ "}{s}
            </div>
          ))}
        </div>
      </div>

      <div className="dash">
        <Column title="Company">
          <Bar w="72%" h={16} />
          <div className="skl-stack">
            <Bar w="96%" /><Bar w="90%" /><Bar w="93%" /><Bar w="61%" />
          </div>
          <div className="skl-label"><Bar w="34%" h={9} /></div>
          <div className="skl-stack">
            <Bar w="66%" /><Bar w="58%" /><Bar w="71%" /><Bar w="52%" />
          </div>
        </Column>

        <Column title="Analytics">
          <div className="skl-stack">
            <Bar w="40%" h={14} /><Bar w="72%" />
          </div>
          <div className="skl-stats">
            {[0, 1, 2].map((i) => (
              <div key={i} className="skl-stat"><Bar w="58%" h={9} /><Bar w="72%" h={26} /></div>
            ))}
          </div>
          <div className="skl-chart" aria-hidden="true" />
        </Column>

        <Column title="Agents feed">
          {[0, 1, 2, 3].map((i) => (
            <div className="skl-row" key={i}>
              <span className="skl skl-dot" aria-hidden="true" />
              <span className="skl-rowb"><Bar w="54%" /><Bar w="78%" h={9} /></span>
            </div>
          ))}
        </Column>

        <Column title="Talk to AI CMO">
          <div className="skl-stack">
            <Bar w="88%" /><Bar w="94%" /><Bar w="70%" />
          </div>
          <div className="skl-msg-me"><Bar w="60%" /></div>
          <div className="skl-stack">
            <Bar w="92%" /><Bar w="85%" /><Bar w="64%" />
          </div>
        </Column>
      </div>
    </div>
  );
}
