import { LegalList, LegalPageLayout, LegalSection } from './LegalPageLayout.js';

function AccountDeletion() {
    return (
        <LegalPageLayout title="Account and Data Deletion" updated="July 2, 2026">
            <LegalSection title="Durqan Account Deletion">
                <p>
                    This page explains how Durqan users can request deletion of their account and
                    associated data. Durqan is the app name used for the web and mobile social
                    messaging service.
                </p>
                <p>
                    At this time, account deletion requests are handled by email. If an in-app
                    deletion option is added in the future, you may also use that option from your
                    account settings.
                </p>
            </LegalSection>

            <LegalSection title="To Request Deletion by Email">
                <LegalList>
                    <li>Send an email to <a className="text-sky-700 underline" href="mailto:duircianos@icloud.com">duircianos@icloud.com</a>.</li>
                    <li>Use the subject line: <strong>Account deletion request</strong>.</li>
                    <li>Include the account email address and username or display name associated with the account.</li>
                    <li>Send the request from the email address connected to your Durqan account when possible.</li>
                </LegalList>
                <p>
                    We may ask for additional information if needed to verify that the requester is
                    the account owner.
                </p>
            </LegalSection>

            <LegalSection title="What We Delete">
                <p>
                    After verification, we will delete or anonymize account-related data where
                    technically possible, including:
                </p>
                <LegalList>
                    <li>Profile and account data, such as email, username, profile details, avatar, and account settings.</li>
                    <li>Messages associated with the account, where technically possible and consistent with conversation integrity and abuse-prevention needs.</li>
                    <li>Uploaded content and attachments associated with the account, where technically possible.</li>
                    <li>Push notification tokens, active sessions, and related authentication data.</li>
                </LegalList>
            </LegalSection>

            <LegalSection title="Data That May Be Retained Temporarily">
                <p>
                    Some information may remain for a limited time after deletion because of
                    technical, security, or legal reasons, including:
                </p>
                <LegalList>
                    <li>Security logs and abuse-prevention records.</li>
                    <li>Backup copies until they expire or are overwritten according to normal backup cycles.</li>
                    <li>Records needed to investigate misuse, fraud, spam, or safety incidents.</li>
                    <li>Information we are required to retain to comply with applicable legal obligations.</li>
                </LegalList>
            </LegalSection>

            <LegalSection title="Processing Time">
                <p>
                    We aim to process verified deletion requests as soon as reasonably possible.
                    Deletion may take up to 30 days, depending on verification, technical systems,
                    backups, and operational constraints.
                </p>
            </LegalSection>

            <LegalSection title="Questions">
                <p>
                    For questions about account deletion or data deletion, contact us at{' '}
                    <a className="text-sky-700 underline" href="mailto:duircianos@icloud.com">duircianos@icloud.com</a>.
                </p>
            </LegalSection>
        </LegalPageLayout>
    );
}

export default AccountDeletion;
