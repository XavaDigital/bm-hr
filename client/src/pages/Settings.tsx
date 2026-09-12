import { useEffect, useState } from 'react';
import { Alert, Button, Card, Col, Form, Input, InputNumber, Row, Select, Spin, Typography, App as AntApp } from 'antd';
import { api, describeError } from '../api';
import { LeaveSettingsCard } from '../components/LeaveSettingsCard';
import type { WiseSettings } from '../types';

interface FormShape {
  sourceCurrency: string;
  headers: string;
  gcashMode: 'source' | 'target';
  gcashFeeFixed: number;
  gcashFeePct: number; // percent in the UI, fraction in the API
  wiseMode: 'source' | 'target';
  wiseFeeFixed: number;
  wiseFeePct: number;
}

export function Settings() {
  const { message } = AntApp.useApp();
  const [initial, setInitial] = useState<FormShape | null>(null);
  const [saving, setSaving] = useState(false);
  const [sample, setSample] = useState(200);
  const [form] = Form.useForm<FormShape>();
  const gFixed = Form.useWatch('gcashFeeFixed', form) ?? 0;
  const gPct = Form.useWatch('gcashFeePct', form) ?? 0;

  useEffect(() => {
    api<{ wise: WiseSettings }>('/api/settings/wise')
      .then(({ wise }) =>
        setInitial({
          sourceCurrency: wise.sourceCurrency,
          headers: wise.headers.join(','),
          gcashMode: wise.kinds.gcash.amountMode,
          gcashFeeFixed: wise.kinds.gcash.feeFixed,
          gcashFeePct: wise.kinds.gcash.feePct * 100,
          wiseMode: wise.kinds.wise_account.amountMode,
          wiseFeeFixed: wise.kinds.wise_account.feeFixed,
          wiseFeePct: wise.kinds.wise_account.feePct * 100,
        }),
      )
      .catch((e) => message.error(describeError(e)));
  }, [message]);

  if (!initial) {
    return (
      <div className="page">
        <Spin />
      </div>
    );
  }

  const save = async (v: FormShape) => {
    setSaving(true);
    try {
      await api('/api/settings/wise', {
        method: 'PUT',
        json: {
          sourceCurrency: v.sourceCurrency,
          headers: v.headers.split(',').map((h) => h.trim()).filter(Boolean),
          kinds: {
            gcash: { amountMode: v.gcashMode, feeFixed: v.gcashFeeFixed, feePct: v.gcashFeePct / 100 },
            wise_account: { amountMode: v.wiseMode, feeFixed: v.wiseFeeFixed, feePct: v.wiseFeePct / 100 },
          },
        },
      });
      message.success('Settings saved. New pay runs use them; refresh an open draft to apply.');
    } catch (e) {
      message.error(describeError(e));
    } finally {
      setSaving(false);
    }
  };

  const grossed = gPct < 100 ? Math.ceil(((sample + gFixed) / (1 - gPct / 100)) * 100 - 1e-7) / 100 : NaN;

  return (
    <div className="page">
      <Typography.Title level={3}>Settings</Typography.Title>
      <div style={{ maxWidth: 900 }}>
        <LeaveSettingsCard />
      </div>
      <Form<FormShape> form={form} layout="vertical" initialValues={initial} onFinish={save} style={{ maxWidth: 900 }}>
        <Card title="Wise batch export" style={{ marginBottom: 16 }}>
          <Row gutter={16}>
            <Col xs={24} md={6}>
              <Form.Item name="sourceCurrency" label="Source currency" rules={[{ required: true, len: 3 }]}>
                <Input maxLength={3} />
              </Form.Item>
            </Col>
            <Col xs={24} md={18}>
              <Form.Item name="headers" label="CSV columns, in order (from the Wise saved-recipients template)" rules={[{ required: true }]}>
                <Input.TextArea rows={2} />
              </Form.Item>
            </Col>
          </Row>
          <Typography.Paragraph className="muted" style={{ marginBottom: 0 }}>
            If Wise changes its template, download a fresh one and paste its header row here. Known columns are filled; unknown ones are left blank.
          </Typography.Paragraph>
        </Card>

        <Card title="GCash recipients (USD → PHP)" style={{ marginBottom: 16 }}>
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message="Source mode grosses up the USD amount so the recipient still gets their full pay after Wise takes its fee. Calibrate the two fee numbers from what Wise shows on the batch review screen."
          />
          <Row gutter={16}>
            <Col xs={24} md={8}>
              <Form.Item name="gcashMode" label="Amount mode">
                <Select
                  options={[
                    { value: 'source', label: 'source (gross up USD)' },
                    { value: 'target', label: 'target (exact PHP; not supported for USD pay)' },
                  ]}
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="gcashFeeFixed" label="Wise fixed fee (USD)">
                <InputNumber min={0} precision={2} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="gcashFeePct" label="Wise variable fee (%)">
                <InputNumber min={0} max={50} precision={3} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16} align="middle">
            <Col>
              Check: to net <InputNumber size="small" value={sample} min={1} precision={2} onChange={(v) => setSample(v ?? 0)} style={{ width: 110 }} /> USD, send{' '}
              <b>{Number.isFinite(grossed) ? grossed.toFixed(2) : '—'}</b> USD
            </Col>
          </Row>
        </Card>

        <Card title="Wise account recipients (USD → USD)" style={{ marginBottom: 16 }}>
          <Row gutter={16}>
            <Col xs={24} md={8}>
              <Form.Item name="wiseMode" label="Amount mode">
                <Select
                  options={[
                    { value: 'target', label: 'target (recipient gets exact USD)' },
                    { value: 'source', label: 'source (gross up USD)' },
                  ]}
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="wiseFeeFixed" label="Wise fixed fee (USD)">
                <InputNumber min={0} precision={2} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="wiseFeePct" label="Wise variable fee (%)">
                <InputNumber min={0} max={50} precision={3} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Typography.Paragraph className="muted" style={{ marginBottom: 0 }}>
            Fees only apply in source mode. In target mode Wise charges the fee on top automatically.
          </Typography.Paragraph>
        </Card>

        <Button type="primary" htmlType="submit" loading={saving}>
          Save settings
        </Button>
      </Form>
    </div>
  );
}
