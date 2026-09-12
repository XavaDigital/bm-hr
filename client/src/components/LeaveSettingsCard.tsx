import { useEffect, useState } from 'react';
import { Button, Card, Col, Form, Input, InputNumber, Row, Select, Spin, Typography, App as AntApp } from 'antd';
import { api, describeError } from '../api';
import type { LeaveSettings } from '../types';

export function LeaveSettingsCard() {
  const { message } = AntApp.useApp();
  const [initial, setInitial] = useState<LeaveSettings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api<{ leave: LeaveSettings }>('/api/settings/leave')
      .then((r) => setInitial(r.leave))
      .catch((e) => message.error(describeError(e)));
  }, [message]);

  if (!initial) return <Spin />;

  const save = async (v: LeaveSettings) => {
    setSaving(true);
    try {
      await api('/api/settings/leave', { method: 'PUT', json: { ...v, sickDays: v.sickDays ?? null } });
      message.success('Leave defaults saved. People with their own policy are unaffected.');
    } catch (e) {
      message.error(describeError(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card title="Leave defaults and reminders" style={{ marginBottom: 16 }}>
      <Form<LeaveSettings> layout="vertical" initialValues={initial} onFinish={save}>
        <Row gutter={16}>
          <Col xs={12} md={6}>
            <Form.Item name="annualEntitlementDays" label="Annual leave days">
              <InputNumber min={0} step={0.5} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col xs={12} md={6}>
            <Form.Item name="accrual" label="Accrual">
              <Select
                options={[
                  { value: 'monthly', label: 'Monthly' },
                  { value: 'front_loaded', label: 'All at year start' },
                ]}
              />
            </Form.Item>
          </Col>
          <Col xs={12} md={6}>
            <Form.Item name="carryOverMaxDays" label="Max carry-over">
              <InputNumber min={0} step={0.5} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col xs={12} md={6}>
            <Form.Item name="leaveYearStart" label="Leave year starts (MM-DD)" rules={[{ pattern: /^\d{2}-\d{2}$/, message: 'MM-DD' }]}>
              <Input />
            </Form.Item>
          </Col>
          <Col xs={12} md={6}>
            <Form.Item name="sickDays" label="Sick days per year (blank = untracked)">
              <InputNumber min={0} step={0.5} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col xs={12} md={6}>
            <Form.Item name="payRiseDueMonths" label="Flag pay rise after (months)">
              <InputNumber min={1} max={120} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
        </Row>
        <Typography.Paragraph className="muted" style={{ fontSize: 12 }}>
          These apply to anyone without their own leave policy on their profile. Philippine service incentive leave is 5 days; many teams give 10 to 15.
        </Typography.Paragraph>
        <Button type="primary" htmlType="submit" loading={saving}>
          Save leave defaults
        </Button>
      </Form>
    </Card>
  );
}
