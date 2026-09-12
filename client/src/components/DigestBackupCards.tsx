import { useEffect, useState } from 'react';
import { Alert, Button, Card, Form, Input, Modal, Select, Space, Spin, Switch, Typography, App as AntApp } from 'antd';
import { api, describeError } from '../api';
import type { DigestSettings } from '../types';

export function DigestCard() {
  const { message } = AntApp.useApp();
  const [initial, setInitial] = useState<DigestSettings | null>(null);
  const [mailConfigured, setMailConfigured] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null);

  useEffect(() => {
    api<{ digest: DigestSettings }>('/api/settings/digest')
      .then((r) => setInitial(r.digest))
      .catch((e) => message.error(describeError(e)));
    api<{ mailConfigured: boolean }>('/api/digest/preview')
      .then((r) => setMailConfigured(r.mailConfigured))
      .catch(() => setMailConfigured(null));
  }, [message]);

  if (!initial) return <Spin />;

  const save = async (v: DigestSettings) => {
    setSaving(true);
    try {
      await api('/api/settings/digest', { method: 'PUT', json: v });
      message.success('Digest settings saved');
    } catch (e) {
      message.error(describeError(e));
    } finally {
      setSaving(false);
    }
  };

  const showPreview = async () => {
    try {
      setPreview(await api<{ subject: string; html: string }>('/api/digest/preview'));
    } catch (e) {
      message.error(describeError(e));
    }
  };

  const sendTest = async () => {
    try {
      const r = await api<{ sent: boolean; recipients: string[] }>('/api/digest/send', { method: 'POST', json: {} });
      message.success(`Sent to ${r.recipients.join(', ')}`);
    } catch (e) {
      message.error(describeError(e));
    }
  };

  return (
    <Card title="Weekly email digest" style={{ marginBottom: 16 }}>
      {mailConfigured === false && <Alert type="warning" showIcon style={{ marginBottom: 12 }} message="Email is not configured on this deployment (Mailgun key and domain). Preview works; sending does not." />}
      <Form<DigestSettings> layout="vertical" initialValues={initial} onFinish={save}>
        <Space align="start" wrap>
          <Form.Item name="enabled" label="Send weekly" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item name="recipients" label="Recipients" style={{ minWidth: 320 }}>
            <Select mode="tags" tokenSeparators={[',', ' ']} placeholder="email addresses" />
          </Form.Item>
          <Form.Item name="subjectPrefix" label="Subject prefix">
            <Input style={{ width: 180 }} />
          </Form.Item>
        </Space>
        <Typography.Paragraph className="muted" style={{ fontSize: 12 }}>
          Same content as the Today page. Sent by the Cloud Scheduler job in DEPLOY.md, usually Monday morning.
        </Typography.Paragraph>
        <Space>
          <Button type="primary" htmlType="submit" loading={saving}>
            Save
          </Button>
          <Button onClick={showPreview}>Preview</Button>
          <Button onClick={sendTest} disabled={!mailConfigured}>
            Send now
          </Button>
        </Space>
      </Form>
      <Modal title={preview?.subject} open={!!preview} onCancel={() => setPreview(null)} footer={null} width={720}>
        {preview && <iframe title="digest" srcDoc={preview.html} style={{ width: '100%', height: '60vh', border: '1px solid #eee' }} />}
      </Modal>
    </Card>
  );
}

export function BackupCard() {
  const { message } = AntApp.useApp();
  const [status, setStatus] = useState<{ bucket: string | null; configured: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ bucket: string | null; configured: boolean }>('/api/backup/status')
      .then(setStatus)
      .catch(() => setStatus({ bucket: null, configured: false }));
  }, []);

  const upload = async () => {
    setBusy(true);
    try {
      const r = await api<{ object: string; bytes: number }>('/api/backup/upload', { method: 'POST' });
      message.success(`Uploaded ${r.object} (${Math.round(r.bytes / 1024)} KB)`);
    } catch (e) {
      message.error(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Backups" style={{ marginBottom: 16 }}>
      <Typography.Paragraph className="muted" style={{ fontSize: 12 }}>
        Everything in the hr schema as one JSON file. The nightly Cloud Scheduler job uploads a copy to the bucket
        {status?.bucket ? <b> {status.bucket}</b> : status ? ' (not configured: BACKUP_BUCKET unset)' : ''}. Supabase keeps its own database backups as well.
      </Typography.Paragraph>
      <Space>
        <Button href="/api/backup/download">Download backup</Button>
        <Button onClick={upload} loading={busy} disabled={!status?.configured}>
          Upload snapshot now
        </Button>
      </Space>
    </Card>
  );
}
