import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service — Populr",
  description: "The terms that govern your use of Populr.",
};

export default function Terms() {
  return (
    <div className="legal">
      <div className="legal-top">
        <a href="/">← Populr</a>
        <span className="legal-wordmark">Populr.</span>
      </div>

      <h1>Terms of Service</h1>
      <div className="updated">Last updated: 13 July 2026</div>

      <p>
        These Terms of Service (&quot;Terms&quot;) govern your access to and use of Populr (the &quot;Service&quot;).
        By creating an account or using the Service, you agree to these Terms.
      </p>

      <h2>1. The Service</h2>
      <p>
        Populr is an AI marketing assistant that analyzes a website you provide, generates marketing recommendations and
        drafts, and can display analytics from integrations you connect. Every output is provided for your review — nothing
        is published on your behalf without your action.
      </p>

      <h2>2. Accounts</h2>
      <p>
        You are responsible for the credentials to your account and for all activity under it. Provide accurate
        information and keep your password secure. Notify us of any unauthorized use.
      </p>

      <h2>3. Free trial &amp; billing</h2>
      <p>
        New accounts include a free trial period (currently 30 days). After the trial, continued use of paid features
        requires a subscription (currently $15/month). Pricing and trial length may change with notice. You may stop using
        the Service at any time.
      </p>

      <h2>4. Acceptable use</h2>
      <ul>
        <li>Do not use the Service for unlawful, harmful, or abusive purposes.</li>
        <li>Do not attempt to disrupt, reverse-engineer, or gain unauthorized access to the Service.</li>
        <li>Do not resell or redistribute the Service without our permission.</li>
        <li>Only connect accounts and websites that you own or are authorized to access.</li>
      </ul>

      <h2>5. Your content</h2>
      <p>
        You retain ownership of the content you submit and of the outputs generated for you. You grant us a limited license
        to process your content solely to provide the Service. You are responsible for reviewing all AI-generated output
        before using or publishing it.
      </p>
      <p>
        We may use aggregated and de-identified usage and outcome data — such as which types of recommendations were
        acted on and how measured metrics changed afterwards — to improve the Service for all customers. This data does
        not include your name, email, content, or any information that identifies you or your business.
      </p>

      <h2>6. AI output</h2>
      <p>
        AI-generated analysis and drafts may be inaccurate, incomplete, or unsuitable for your purpose. They are not
        professional advice. Always review before acting on them.
      </p>

      <h2>7. Third-party services</h2>
      <p>
        The Service integrates with third parties (such as AI providers and Google Search Console). Your use of those
        integrations is also subject to their terms. We are not responsible for third-party services.
      </p>

      <h2>8. Disclaimers</h2>
      <p>
        The Service is provided &quot;as is&quot; and &quot;as available&quot; without warranties of any kind, to the
        fullest extent permitted by law.
      </p>

      <h2>9. Limitation of liability</h2>
      <p>
        To the fullest extent permitted by law, Populr will not be liable for any indirect, incidental, or consequential
        damages, or for lost profits or data, arising from your use of the Service.
      </p>

      <h2>10. Termination</h2>
      <p>
        You may stop using the Service at any time. We may suspend or terminate access if these Terms are violated or as
        needed to protect the Service.
      </p>

      <h2>11. Changes</h2>
      <p>We may update these Terms; material changes will be reflected by the &quot;Last updated&quot; date above.</p>

      <h2>12. Contact</h2>
      <p>Questions about these Terms? Email <a href="mailto:team@trypopulr.in">team@trypopulr.in</a>.</p>

      <div className="legal-foot">
        <a href="/">Home</a>
        <a href="/privacy">Privacy Policy</a>
        <a href="mailto:team@trypopulr.in">Contact</a>
      </div>
    </div>
  );
}
