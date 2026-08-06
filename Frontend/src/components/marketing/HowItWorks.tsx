const STEPS: Array<{ title: string; body: string }> = [
  {
    title: 'Create your account',
    body: 'An email address and a password is the whole of it. There is nothing to connect and no workspace to configure first. Turning on two-factor authentication from your security page takes about a minute, and you should.',
  },
  {
    title: 'Capture the work',
    body: 'Add tasks with a priority, a due date, tags and any files that belong with them. Reorder by hand when the plan changes, because it will, and narrow the list to whatever you actually need to look at right now.',
  },
  {
    title: 'Finish it, then prove it',
    body: 'Your completion rate and current streak are counted as you go. When somebody asks for the record, export exactly the view you are looking at as a PDF, a spreadsheet, JSON, Markdown or a calendar file.',
  },
];

export function HowItWorks() {
  return (
    <section
      id="how-it-works"
      className="tf-lp__section tf-lp__section--alt"
      aria-labelledby="how-heading"
    >
      <div className="tf-container">
        <div className="tf-lp__head">
          <p className="tf-lp__kicker">How it works</p>
          <h2 id="how-heading" className="tf-lp__h2">
            Three steps, and then you are working
          </h2>
          <p className="tf-lp__lede">
            No onboarding tour to sit through, no integrations to authorise, no sample project to
            delete before you can start.
          </p>
        </div>

        {/* An ordered list rather than three cards: the steps happen in this
            order, and a screen reader should say so without relying on the
            numerals being read out as content.

            `role="list"` is redundant markup that is load-bearing anyway:
            WebKit strips list semantics from any list styled `list-style: none`,
            which this one is, and VoiceOver would then announce three loose
            paragraphs, losing the ordering the element was chosen for. */}
        <ol className="tf-lp__steps" role="list">
          {STEPS.map((step, index) => (
            <li key={step.title} className="tf-lp__step">
              <span className="tf-lp__step-num" aria-hidden="true">
                STEP {String(index + 1).padStart(2, '0')}
              </span>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
