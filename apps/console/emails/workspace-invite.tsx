import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from '@react-email/components';

type Props = {
  inviterName: string;
  workspaceName: string;
  inviteUrl: string;
};

// Plain, branded, no emoji — Tempo voice. Designed for the small set of
// email clients that matter (Gmail, Outlook, Apple Mail).
export default function WorkspaceInviteEmail({ inviterName, workspaceName, inviteUrl }: Props) {
  const preview = `${inviterName} invited you to ${workspaceName} on Tempo`;
  return (
    <Html>
      <Head />
      <Preview>{preview}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Section>
            <Heading style={heading}>Tempo</Heading>
            <Text style={paragraph}>
              <strong>{inviterName}</strong> invited you to join <strong>{workspaceName}</strong> on
              Tempo — a planning tool for engineers.
            </Text>
            <Button style={button} href={inviteUrl}>
              Accept invitation
            </Button>
            <Text style={fineprint}>
              Or copy this link:{' '}
              <a href={inviteUrl} style={link}>
                {inviteUrl}
              </a>
            </Text>
            <Hr style={hr} />
            <Text style={fineprint}>
              If you weren't expecting this, you can safely ignore the email.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

const body: React.CSSProperties = {
  backgroundColor: '#f7f7f5',
  fontFamily:
    'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  margin: 0,
  padding: '40px 0',
};
const container: React.CSSProperties = {
  backgroundColor: '#ffffff',
  border: '1px solid #e5e5e0',
  borderRadius: '8px',
  margin: '0 auto',
  maxWidth: '520px',
  padding: '40px',
};
const heading: React.CSSProperties = {
  color: '#1a1a1a',
  fontSize: '20px',
  fontWeight: 600,
  letterSpacing: '-0.01em',
  margin: '0 0 24px',
};
const paragraph: React.CSSProperties = {
  color: '#333333',
  fontSize: '15px',
  lineHeight: 1.6,
  margin: '0 0 24px',
};
const button: React.CSSProperties = {
  backgroundColor: '#1a1a1a',
  borderRadius: '6px',
  color: '#ffffff',
  display: 'inline-block',
  fontSize: '14px',
  fontWeight: 500,
  padding: '10px 24px',
  textDecoration: 'none',
};
const link: React.CSSProperties = { color: '#666666', wordBreak: 'break-all' };
const fineprint: React.CSSProperties = {
  color: '#666666',
  fontSize: '13px',
  lineHeight: 1.5,
  margin: '24px 0 0',
};
const hr: React.CSSProperties = {
  border: 'none',
  borderTop: '1px solid #e5e5e0',
  margin: '32px 0 0',
};
