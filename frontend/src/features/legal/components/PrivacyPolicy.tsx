import { LegalList, LegalPageLayout, LegalSection } from './LegalPageLayout.js';

function PrivacyPolicy() {
    return (
        <LegalPageLayout title="Privacy Policy" updated="July 2, 2026">
            <LegalSection title="Overview">
                <p>
                    This Privacy Policy explains how Durqan collects, uses, stores, and protects
                    information when you use the Durqan web and mobile applications. Durqan is a
                    social and messaging application operated for user profiles, posts, friendships,
                    chats, calls, attachments, and notifications.
                </p>
                <p>
                    If you do not agree with this policy, do not use the service. For questions,
                    contact us at <a className="text-sky-700 underline" href="mailto:duircianos@icloud.com">duircianos@icloud.com</a>.
                </p>
            </LegalSection>

            <LegalSection title="Information We Collect">
                <LegalList>
                    <li>Account data, such as email address, username or display name, password hash, profile information, avatar, and account settings.</li>
                    <li>Messages metadata, such as sender and recipient identifiers, timestamps, delivery/read state, reactions, reply/forward relationships, and conversation state.</li>
                    <li>Encrypted message content. In E2EE conversations, text message content is encrypted on the user's device before it is sent, and the server stores ciphertext.</li>
                    <li>Attachments and uploaded content, including images, videos, audio, files, voice messages, and video notes. Depending on the conversation and implementation path, attachments may be stored as encrypted blobs or as legacy uploads.</li>
                    <li>Device and push notification data, including push tokens and notification subscription data needed to deliver notifications.</li>
                    <li>Technical, security, and diagnostic data, such as IP address, user agent, device type, request timing, authentication/session events, abuse-prevention signals, and server logs.</li>
                </LegalList>
            </LegalSection>

            <LegalSection title="How We Use Information">
                <LegalList>
                    <li>To create and operate your account, profile, friendships, posts, calls, and chat features.</li>
                    <li>To deliver messages, attachments, read receipts, reactions, and real-time chat events.</li>
                    <li>To provide push notifications and keep device notification tokens up to date.</li>
                    <li>To protect the service, prevent abuse, investigate security issues, and enforce access controls.</li>
                    <li>To maintain, debug, improve, and support the application and infrastructure.</li>
                </LegalList>
            </LegalSection>

            <LegalSection title="Message and Attachment Encryption">
                <p>
                    Durqan supports end-to-end encryption for text messages when both chat
                    participants have E2EE enabled and key material is available. In that mode,
                    message text is encrypted on the client before upload. The server stores the
                    encrypted payload and does not receive the plaintext message content.
                </p>
                <p>
                    For conversations where E2EE is not available, message text may be protected by
                    server-side encryption at rest. This protects stored database content but is not
                    the same as end-to-end encryption.
                </p>
                <p>
                    Attachments can be handled separately from text messages. New attachments in
                    E2EE-ready conversations may be encrypted on the client before upload and stored
                    as encrypted blobs. Legacy attachments, or attachments sent when E2EE is not
                    available, may be stored and served through the standard attachment storage path.
                </p>
            </LegalSection>

            <LegalSection title="Cookies and Sessions">
                <p>
                    Durqan uses cookies and session-related data to keep users signed in, protect
                    authenticated requests, prevent cross-site request forgery, and maintain secure
                    application sessions. Public pages such as this Privacy Policy do not require a
                    logged-in session.
                </p>
            </LegalSection>

            <LegalSection title="Third-Party Services and Infrastructure">
                <p>
                    Durqan may use third-party or external infrastructure providers to operate the
                    service, including:
                </p>
                <LegalList>
                    <li>Hosting, server, database, cache, and networking infrastructure.</li>
                    <li>S3-compatible object storage for uploaded files and attachments.</li>
                    <li>Firebase Cloud Messaging for Android push notifications.</li>
                </LegalList>
                <p>
                    These providers process data only as needed to operate, secure, and deliver the
                    service.
                </p>
            </LegalSection>

            <LegalSection title="Data Retention">
                <p>
                    We keep account data and user content while your account is active or as needed
                    to provide the service. Some data may remain for a limited time in backups,
                    technical logs, security records, or abuse-prevention records. Retention periods
                    may vary depending on operational and security needs.
                </p>
            </LegalSection>

            <LegalSection title="Your Rights and Choices">
                <LegalList>
                    <li>You may request access to information associated with your account.</li>
                    <li>You may request deletion of your account and associated data.</li>
                    <li>You may request removal of push notification tokens by signing out or contacting support.</li>
                    <li>You may contact us for privacy or data deletion questions at <a className="text-sky-700 underline" href="mailto:duircianos@icloud.com">duircianos@icloud.com</a>.</li>
                </LegalList>
            </LegalSection>

            <LegalSection title="Contact">
                <p>
                    For privacy requests, data deletion requests, or questions about this policy,
                    email <a className="text-sky-700 underline" href="mailto:duircianos@icloud.com">duircianos@icloud.com</a>.
                </p>
            </LegalSection>
        </LegalPageLayout>
    );
}

export default PrivacyPolicy;
