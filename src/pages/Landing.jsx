import './Landing.css'

const features = [
  {
    icon: '✨',
    title: 'AI Recipe Generation',
    desc: "Tell Claude what's in your fridge and get 3 tailored recipes instantly — prioritising ingredients about to expire so nothing goes to waste.",
  },
  {
    icon: '⏰',
    title: 'Expiry Tracking',
    desc: 'Never throw away forgotten food again. KitAura flags items expiring soon and surfaces them first when suggesting what to cook.',
  },
  {
    icon: '🛒',
    title: 'Smart Shopping List',
    desc: 'Missing an ingredient for tonight\'s recipe? Add it to your list in one tap. Items auto-populate from your meal plan too.',
  },
  {
    icon: '📅',
    title: 'Meal Planning',
    desc: 'Plan breakfast, lunch and dinner for the week. See everything at a glance and never answer "what\'s for dinner?" again.',
  },
  {
    icon: '🏠',
    title: 'Household Sharing',
    desc: 'Share your pantry, shopping list and meal plan with your whole household in real time using a simple invite code.',
  },
  {
    icon: '💰',
    title: 'Grocery Spend Tracker',
    desc: 'Log your grocery trips and scan receipts to understand where your food budget actually goes, week by week.',
  },
]

const steps = [
  { number: '01', title: 'Add your inventory', desc: 'Scan a photo of your fridge or manually add what you have at home.' },
  { number: '02', title: 'Generate recipes', desc: 'Claude looks at your ingredients and suggests meals you can make right now.' },
  { number: '03', title: 'Plan your week', desc: 'Add recipes to your meal planner and let shopping lists build themselves.' },
]

export default function Landing({ onGetStarted }) {
  return (
    <div className="landing">
      {/* Nav */}
      <nav className="landing-nav">
        <div className="landing-nav-inner">
          <span className="landing-logo">KitAura</span>
          <button className="btn btn-ghost landing-signin-btn" onClick={onGetStarted}>Sign in</button>
        </div>
      </nav>

      {/* Hero */}
      <section className="landing-hero">
        <div className="landing-hero-glow" />
        <div className="landing-hero-content">
          <div className="landing-eyebrow">Powered by Claude AI</div>
          <h1 className="landing-headline">
            Your kitchen,<br />
            <span className="landing-headline-accent">intelligently organised</span>
          </h1>
          <p className="landing-sub">
            KitAura turns your fridge into a recipe engine. Track what you have, eliminate food waste,
            plan your meals, and let AI do the thinking — so you just have to cook.
          </p>
          <div className="landing-hero-actions">
            <button className="btn btn-primary landing-cta" onClick={onGetStarted}>
              Get started free
            </button>
            <a href="#features" className="btn btn-ghost">See what's inside</a>
          </div>
        </div>

        {/* Hero visual */}
        <div className="landing-hero-visual">
          <div className="hero-card hero-card-main">
            <div className="hero-card-header">
              <span className="hero-card-dot" />
              <span className="hero-card-title">What can I make tonight?</span>
            </div>
            <div className="hero-recipe-list">
              {['Garlic Butter Chicken', 'Tomato Pasta', 'Veggie Stir Fry'].map((r, i) => (
                <div key={r} className="hero-recipe-item">
                  <span className="hero-recipe-sparkle">✨</span>
                  <span className="hero-recipe-name">{r}</span>
                  <span className={`hero-recipe-diff diff-${['Easy','Medium','Easy'][i].toLowerCase()}`}>{['Easy','Medium','Easy'][i]}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="hero-card hero-card-expiry">
            <div className="hero-card-label">Expiring soon</div>
            <div className="hero-expiry-list">
              {[['Spinach', '1 day'],['Milk', '2 days'],['Chicken', '3 days']].map(([item, when]) => (
                <div key={item} className="hero-expiry-item">
                  <span className="hero-expiry-dot" />
                  <span className="hero-expiry-name">{item}</span>
                  <span className="hero-expiry-when">{when}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="hero-card hero-card-stat">
            <div className="hero-stat-value">12</div>
            <div className="hero-stat-label">items in pantry</div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="landing-features" id="features">
        <div className="landing-section-inner">
          <div className="landing-section-header">
            <div className="landing-eyebrow">Everything you need</div>
            <h2 className="landing-section-title">A smarter way to run your kitchen</h2>
            <p className="landing-section-sub">From AI-powered recipes to real-time household sharing — KitAura handles the logistics so you can focus on the food.</p>
          </div>
          <div className="features-grid">
            {features.map(f => (
              <div key={f.title} className="feature-card">
                <div className="feature-icon">{f.icon}</div>
                <h3 className="feature-title">{f.title}</h3>
                <p className="feature-desc">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="landing-how">
        <div className="landing-section-inner">
          <div className="landing-section-header">
            <div className="landing-eyebrow">How it works</div>
            <h2 className="landing-section-title">Up and running in minutes</h2>
          </div>
          <div className="steps-row">
            {steps.map((s, i) => (
              <div key={s.number} className="step-card">
                <div className="step-number">{s.number}</div>
                <h3 className="step-title">{s.title}</h3>
                <p className="step-desc">{s.desc}</p>
                {i < steps.length - 1 && <div className="step-arrow">→</div>}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* AI highlight */}
      <section className="landing-ai">
        <div className="landing-section-inner">
          <div className="ai-highlight-card">
            <div className="ai-highlight-glow" />
            <div className="ai-highlight-content">
              <div className="landing-eyebrow">Claude AI inside</div>
              <h2 className="ai-highlight-title">Recipes that use what you actually have</h2>
              <p className="ai-highlight-desc">
                KitAura connects directly to Claude, Anthropic's AI. When you ask for recipe ideas,
                Claude scans your entire inventory — flagging items expiring soon, checking what you
                have enough of, and generating step-by-step recipes tailored to your kitchen.
                No guessing. No wasted trips to the store.
              </p>
              <button className="btn btn-primary" onClick={onGetStarted}>Try it free</button>
            </div>
            <div className="ai-highlight-visual">
              <div className="ai-chat-bubble ai-chat-user">What can I make with chicken, spinach and garlic?</div>
              <div className="ai-chat-bubble ai-chat-ai">
                <span className="ai-chat-label">KitAura</span>
                Here are 3 recipes using your inventory — I've prioritised the spinach since it expires tomorrow…
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="landing-cta-section">
        <div className="landing-section-inner">
          <div className="cta-card">
            <h2 className="cta-title">Ready to stop wasting food?</h2>
            <p className="cta-sub">Join KitAura and let AI turn your fridge into dinner.</p>
            <button className="btn btn-primary landing-cta" onClick={onGetStarted}>
              Get started — it's free
            </button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="landing-footer">
        <div className="landing-nav-inner">
          <span className="landing-logo landing-footer-logo">KitAura</span>
          <span className="landing-footer-copy">© {new Date().getFullYear()} KitAura. All rights reserved.</span>
        </div>
      </footer>
    </div>
  )
}
