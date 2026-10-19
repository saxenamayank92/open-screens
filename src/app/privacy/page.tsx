import React from "react";

export const metadata = {
  title: "Privacy Policy · OpenScreens",
  description: "Privacy Policy for OpenScreens display receiver and content management platform.",
};

export default function PrivacyPage() {
  return (
    <main
      style={{
        maxWidth: 800,
        margin: "0 auto",
        padding: "48px 24px",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        color: "#1a202c",
        lineHeight: 1.7,
      }}
    >
      <div style={{ marginBottom: 32 }}>
        <a
          href="/login"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            color: "#122046",
            textDecoration: "none",
            fontSize: 14,
            fontWeight: 500,
            marginBottom: 20,
          }}
        >
          ← Back to OpenScreens
        </a>
        <h1 style={{ fontSize: 32, fontWeight: 700, color: "#122046", marginBottom: 8 }}>
          Privacy Policy
        </h1>
        <p style={{ color: "#718096", fontSize: 14 }}>Last updated: September 19, 2026</p>
      </div>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 20, fontWeight: 600, color: "#122046", marginBottom: 12 }}>
          1. Overview
        </h2>
        <p>
          The <strong>OpenScreens</strong> application is a private digital signage receiver
          and content management system designed exclusively for use on authorized television displays
          and by authorized display operators.
        </p>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 20, fontWeight: 600, color: "#122046", marginBottom: 12 }}>
          2. Information We Collect
        </h2>
        <p>
          <strong>Television App (Android TV Receiver):</strong>
        </p>
        <ul style={{ paddingLeft: 24, marginTop: 8 }}>
          <li>
            <strong>Device Identifiers & Diagnostics:</strong> The receiver transmits technical device
            metrics including screen resolution, app version, connection status, and heartbeat timestamps
            strictly for remote display management.
          </li>
          <li>
            <strong>No Personal Data:</strong> The Android TV application does not collect, track, or
            store any personal consumer data, browsing history, microphone audio, camera feeds, or
            location data.
          </li>
        </ul>

        <p style={{ marginTop: 16 }}>
          <strong>Web Workspace & Staff Portal:</strong>
        </p>
        <ul style={{ paddingLeft: 24, marginTop: 8 }}>
          <li>
            <strong>Account Information:</strong> Invited club administrators provide an email address,
            name, and secure password credentials to manage content and screen pairings.
          </li>
          <li>
            <strong>Audit Logging:</strong> System actions (publishing schedules, uploading media assets,
            pairing screens) are logged for internal security and administrative accountability.
          </li>
        </ul>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 20, fontWeight: 600, color: "#122046", marginBottom: 12 }}>
          3. How Information Is Used
        </h2>
        <p>
          Information collected is used solely to deliver scheduled club announcements, sports schedules,
          weather, and event information to paired displays across club facilities. We do not sell, rent,
          or monetize any data.
        </p>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 20, fontWeight: 600, color: "#122046", marginBottom: 12 }}>
          4. Security & Retention
        </h2>
        <p>
          All network communications occur over encrypted TLS connections (HTTPS). Authentication tokens
          and pairing challenges are hashed using cryptographic standards. Content is stored securely on
          dedicated cloud infrastructure.
        </p>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 20, fontWeight: 600, color: "#122046", marginBottom: 12 }}>
          5. Contact Us
        </h2>
        <p>
          If you have questions regarding this Privacy Policy or display management at OpenScreens,
          please contact:
        </p>
        <p style={{ marginTop: 8 }}>
          <strong>OpenScreens</strong>
          <br />
          Open Source Project
          <br />
          Website:{" "}
          <a
            href="https://github.com/saxenamayank92/open-screens"
            style={{ color: "#c5a059", textDecoration: "underline" }}
            target="_blank"
            rel="noopener noreferrer"
          >
            github.com/saxenamayank92/open-screens
          </a>
        </p>
      </section>
    </main>
  );
}
