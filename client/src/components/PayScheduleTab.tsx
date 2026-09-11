import { useState } from 'react';
import { Alert, Button, Col, Form, Input, InputNumber, Row, Select, Switch, App as AntApp } from 'antd';
import { api, describeError } from '../api';
import { WEEKDAYS, type PayFrequency, type PaySchedule, type PayoutMethod, type TeamMember, type WiseRecipientKind } from '../types';

interface FormShape {
  frequency: PayFrequency;
  payDay: number | null;
  payoutMethod: PayoutMethod;
  wiseRecipientId: string | null;
  wiseRecipientName: string | null;
  wiseRecipientEmail: string | null;
  wiseRecipientKind: WiseRecipientKind | null;
  wiseRecipientDetail: string | null;
  targetCurrency: string | null;
  invoicePrefix: string | null;
  nextInvoiceNumber: number | null;
  thirteenthMonth: boolean;
  thirteenthMonthPayMonth: number;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function PayScheduleTab({
  memberId,
  schedule,
  member,
  onChange,
}: {
  memberId: string;
  schedule: PaySchedule | null;
  member: TeamMember;
  onChange: () => Promise<void>;
}) {
  const { message } = AntApp.useApp();
  const [form] = Form.useForm<FormShape>();
  const [saving, setSaving] = useState(false);
  const payoutMethod = Form.useWatch('payoutMethod', form) ?? schedule?.payoutMethod ?? 'wise';
  const frequency = Form.useWatch('frequency', form) ?? schedule?.frequency ?? 'weekly';
  const kind = Form.useWatch('wiseRecipientKind', form) ?? schedule?.wiseRecipientKind ?? null;

  const initial: FormShape = {
    frequency: schedule?.frequency ?? 'weekly',
    payDay: schedule?.payDay ?? 5,
    payoutMethod: schedule?.payoutMethod ?? 'wise',
    wiseRecipientId: schedule?.wiseRecipientId ?? null,
    wiseRecipientName: schedule?.wiseRecipientName ?? `${member.firstName} ${member.lastName}`,
    wiseRecipientEmail: schedule?.wiseRecipientEmail ?? member.email,
    wiseRecipientKind: schedule?.wiseRecipientKind ?? null,
    wiseRecipientDetail: schedule?.wiseRecipientDetail ?? null,
    targetCurrency: schedule?.targetCurrency ?? null,
    invoicePrefix: schedule?.invoicePrefix ?? 'INV',
    nextInvoiceNumber: schedule?.nextInvoiceNumber ?? 1,
    thirteenthMonth: schedule?.thirteenthMonth ?? member.country === 'PH',
    thirteenthMonthPayMonth: schedule?.thirteenthMonthPayMonth ?? 12,
  };

  const submit = async (v: FormShape) => {
    setSaving(true);
    try {
      const body = { ...v };
      if (body.payoutMethod !== 'wise') {
        body.wiseRecipientId = null;
        body.wiseRecipientKind = null;
        body.wiseRecipientDetail = null;
        body.targetCurrency = null;
      } else if (body.wiseRecipientKind === 'gcash' && !body.targetCurrency) {
        body.targetCurrency = 'PHP';
      } else if (body.wiseRecipientKind === 'wise_account' && !body.targetCurrency) {
        body.targetCurrency = 'USD';
      }
      await api(`/api/members/${memberId}/pay-schedule`, { method: 'PUT', json: body });
      message.success('Pay schedule saved');
      await onChange();
    } catch (e) {
      message.error(describeError(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Form<FormShape> form={form} layout="vertical" initialValues={initial} onFinish={submit} style={{ maxWidth: 900 }}>
      <Row gutter={16}>
        <Col xs={24} md={8}>
          <Form.Item name="payoutMethod" label="Payout method">
            <Select
              options={[
                { value: 'wise', label: 'Wise batch payment' },
                { value: 'xero_bank', label: 'Bank transfer via Xero' },
                { value: 'other', label: 'Other' },
              ]}
            />
          </Form.Item>
        </Col>
        <Col xs={24} md={8}>
          <Form.Item name="frequency" label="Frequency">
            <Select
              options={[
                { value: 'weekly', label: 'Weekly' },
                { value: 'fortnightly', label: 'Fortnightly' },
                { value: 'monthly', label: 'Monthly' },
              ]}
            />
          </Form.Item>
        </Col>
        <Col xs={24} md={8}>
          <Form.Item name="payDay" label={frequency === 'monthly' ? 'Day of month' : 'Pay day'}>
            {frequency === 'monthly' ? (
              <InputNumber min={1} max={31} style={{ width: '100%' }} />
            ) : (
              <Select options={WEEKDAYS.map((d, i) => ({ value: i + 1, label: d }))} />
            )}
          </Form.Item>
        </Col>
      </Row>

      {payoutMethod === 'wise' && (
        <>
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message="Wise recipient"
            description="Set the person up as a recipient in Wise first, then copy the recipientId, name, and detail from the saved-recipients batch template. Bank and wallet numbers are never stored here."
          />
          <Row gutter={16}>
            <Col xs={24} md={8}>
              <Form.Item name="wiseRecipientKind" label="Recipient kind" rules={[{ required: true, message: 'Choose GCash or Wise account' }]}>
                <Select
                  options={[
                    { value: 'gcash', label: 'GCash (PHP)' },
                    { value: 'wise_account', label: 'Wise account (USD)' },
                  ]}
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={16}>
              <Form.Item name="wiseRecipientId" label="Wise recipientId" rules={[{ required: true, message: 'Required for the batch export' }]}>
                <Input placeholder="48c85533-4130-476e-519d-29cce4560097" />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="wiseRecipientName" label="Recipient name (as saved in Wise)" rules={[{ required: true }]}>
                <Input />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="wiseRecipientEmail" label="Recipient email (Wise)">
                <Input />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="wiseRecipientDetail" label="recipientDetail">
                <Input placeholder={kind === 'gcash' ? 'GCash · 639…' : 'Wise account'} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="targetCurrency" label="Target currency">
                <Input placeholder={kind === 'gcash' ? 'PHP' : 'USD'} maxLength={3} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="invoicePrefix" label="Payment reference prefix">
                <Input placeholder="INV" />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="nextInvoiceNumber" label="Next reference number">
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
        </>
      )}

      <Row gutter={16}>
        <Col xs={24} md={8}>
          <Form.Item name="thirteenthMonth" label="13th month pay" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Col>
        <Col xs={24} md={8}>
          <Form.Item name="thirteenthMonthPayMonth" label="Paid in">
            <Select options={MONTHS.map((m, i) => ({ value: i + 1, label: m }))} />
          </Form.Item>
        </Col>
      </Row>

      <Button type="primary" htmlType="submit" loading={saving}>
        Save pay schedule
      </Button>
    </Form>
  );
}
