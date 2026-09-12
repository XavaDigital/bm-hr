import { useCallback, useEffect, useState } from 'react';
import { Button, Card, Col, DatePicker, Descriptions, Form, Input, InputNumber, Modal, Popconfirm, Row, Select, Space, Spin, Statistic, Table, Tag, Typography, App as AntApp } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { api, describeError } from '../api';
import { date } from '../format';
import { LeaveRequestModal } from './LeaveRequestModal';
import { LEAVE_STATUS_COLOR, LEAVE_STATUS_LABELS, LEAVE_TYPE_COLOR, LEAVE_TYPE_LABELS, type LeaveAdjustment, type LeaveRequest, type MemberLeave, type TeamMember } from '../types';

interface PolicyForm {
  leaveYearStart: string;
  annualEntitlementDays: number;
  accrual: 'front_loaded' | 'monthly';
  carryOverMaxDays: number;
  sickDays: number | null;
}

interface AdjForm {
  date: Dayjs;
  days: number;
  reason: string;
}

export function LeaveTab({ member }: { member: TeamMember }) {
  const { message } = AntApp.useApp();
  const [data, setData] = useState<MemberLeave | null>(null);
  const [saving, setSaving] = useState(false);
  const [reqModal, setReqModal] = useState<{ open: boolean; existing?: LeaveRequest | null }>({ open: false });
  const [adjOpen, setAdjOpen] = useState(false);
  const [policyForm] = Form.useForm<PolicyForm>();
  const [adjForm] = Form.useForm<AdjForm>();

  const load = useCallback(async () => {
    try {
      setData(await api<MemberLeave>(`/api/members/${member.id}/leave`));
    } catch (e) {
      message.error(describeError(e));
    }
  }, [member.id, message]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!data) return <Spin />;
  const { policy, balance, requests, adjustments } = data;

  const savePolicy = async (v: PolicyForm) => {
    setSaving(true);
    try {
      await api(`/api/members/${member.id}/leave-policy`, { method: 'PUT', json: v });
      message.success('Leave policy saved');
      await load();
    } catch (e) {
      message.error(describeError(e));
    } finally {
      setSaving(false);
    }
  };

  const addAdjustment = async (v: AdjForm) => {
    setSaving(true);
    try {
      await api(`/api/members/${member.id}/leave-adjustments`, { method: 'POST', json: { date: v.date.format('YYYY-MM-DD'), days: v.days, reason: v.reason } });
      setAdjOpen(false);
      adjForm.resetFields();
      await load();
    } catch (e) {
      message.error(describeError(e));
    } finally {
      setSaving(false);
    }
  };

  const removeAdjustment = async (a: LeaveAdjustment) => {
    try {
      await api(`/api/members/${member.id}/leave-adjustments/${a.id}`, { method: 'DELETE' });
      await load();
    } catch (e) {
      message.error(describeError(e));
    }
  };

  const removeRequest = async (r: LeaveRequest) => {
    try {
      await api(`/api/leave/requests/${r.id}`, { method: 'DELETE' });
      await load();
    } catch (e) {
      message.error(describeError(e));
    }
  };

  const tone = balance.available < 0 ? '#cf1322' : undefined;

  return (
    <div>
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title="Available now" value={balance.available} precision={1} suffix="days" valueStyle={{ color: tone }} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title="By year end" value={balance.availableAtYearEnd} precision={1} suffix="days" />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title="Taken / booked" value={`${balance.taken} / ${balance.booked}`} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title="Sick this year" value={balance.sickTaken} suffix={balance.sickDays !== null ? `/ ${balance.sickDays}` : ''} />
          </Card>
        </Col>
      </Row>
      <Descriptions size="small" column={{ xs: 1, md: 3 }} style={{ marginBottom: 16 }}>
        <Descriptions.Item label="Leave year">
          {date(balance.yearStart)} – {date(balance.yearEnd)}
        </Descriptions.Item>
        <Descriptions.Item label="Carried in">{balance.carryIn}</Descriptions.Item>
        <Descriptions.Item label="Entitlement (accrued so far)">
          {balance.entitlement} ({balance.accruedToDate})
        </Descriptions.Item>
        <Descriptions.Item label="Adjustments">{balance.adjustments}</Descriptions.Item>
        <Descriptions.Item label="Pending approval">{balance.pending}</Descriptions.Item>
        <Descriptions.Item label="Unpaid taken">{balance.unpaidTaken}</Descriptions.Item>
      </Descriptions>

      <Card
        size="small"
        title="Leave taken and booked"
        style={{ marginBottom: 16 }}
        extra={
          <Button type="primary" size="small" icon={<PlusOutlined />} onClick={() => setReqModal({ open: true })}>
            Record leave
          </Button>
        }
      >
        <Table<LeaveRequest>
          rowKey="id"
          size="small"
          dataSource={requests}
          pagination={{ pageSize: 10, hideOnSinglePage: true }}
          columns={[
            { title: 'Type', dataIndex: 'type', render: (t: LeaveRequest['type']) => <Tag color={LEAVE_TYPE_COLOR[t]}>{LEAVE_TYPE_LABELS[t]}</Tag> },
            { title: 'From', dataIndex: 'startDate', render: (d: string) => date(d) },
            { title: 'To', dataIndex: 'endDate', render: (d: string) => date(d) },
            { title: 'Days', dataIndex: 'days', align: 'right' },
            { title: 'Status', dataIndex: 'status', render: (s: LeaveRequest['status']) => <Tag color={LEAVE_STATUS_COLOR[s]}>{LEAVE_STATUS_LABELS[s]}</Tag> },
            { title: 'Notes', dataIndex: 'notes', ellipsis: true },
            {
              key: 'a',
              width: 120,
              render: (_, r) => (
                <Space size={0}>
                  <Button type="link" size="small" onClick={() => setReqModal({ open: true, existing: r })}>
                    Edit
                  </Button>
                  <Popconfirm title="Delete?" onConfirm={() => removeRequest(r)}>
                    <Button type="link" size="small" danger>
                      Delete
                    </Button>
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
      </Card>

      <Row gutter={16}>
        <Col xs={24} md={12}>
          <Card size="small" title={`Leave policy${policy.isDefault ? ' (using defaults)' : ''}`}>
            <Form<PolicyForm> form={policyForm} layout="vertical" initialValues={policy} onFinish={savePolicy}>
              <Row gutter={12}>
                <Col span={12}>
                  <Form.Item name="annualEntitlementDays" label="Days per year" rules={[{ required: true }]}>
                    <InputNumber min={0} step={0.5} style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="accrual" label="Accrual">
                    <Select
                      options={[
                        { value: 'monthly', label: 'Monthly (1/12 per month)' },
                        { value: 'front_loaded', label: 'All at year start' },
                      ]}
                    />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="carryOverMaxDays" label="Max carry-over">
                    <InputNumber min={0} step={0.5} style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="leaveYearStart" label="Leave year starts (MM-DD)" rules={[{ pattern: /^\d{2}-\d{2}$/, message: 'MM-DD' }]}>
                    <Input placeholder="01-01" />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="sickDays" label="Sick days per year">
                    <InputNumber min={0} step={0.5} style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
              </Row>
              <Button htmlType="submit" loading={saving}>
                Save policy
              </Button>
            </Form>
          </Card>
        </Col>
        <Col xs={24} md={12}>
          <Card
            size="small"
            title="Balance adjustments"
            extra={
              <Button size="small" icon={<PlusOutlined />} onClick={() => setAdjOpen(true)}>
                Add
              </Button>
            }
          >
            <Typography.Paragraph className="muted" style={{ fontSize: 12 }}>
              Use for an opening balance from the old spreadsheet, or a one-off grant or deduction.
            </Typography.Paragraph>
            <Table<LeaveAdjustment>
              rowKey="id"
              size="small"
              dataSource={adjustments}
              pagination={false}
              columns={[
                { title: 'Date', dataIndex: 'date', render: (d: string) => date(d) },
                { title: 'Days', dataIndex: 'days', align: 'right', render: (n: number) => (n > 0 ? `+${n}` : n) },
                { title: 'Reason', dataIndex: 'reason' },
                {
                  key: 'a',
                  width: 70,
                  render: (_, a) => (
                    <Popconfirm title="Delete?" onConfirm={() => removeAdjustment(a)}>
                      <Button type="link" size="small" danger>
                        Delete
                      </Button>
                    </Popconfirm>
                  ),
                },
              ]}
            />
          </Card>
        </Col>
      </Row>

      <LeaveRequestModal
        open={reqModal.open}
        existing={reqModal.existing}
        defaultMemberId={member.id}
        members={[{ id: member.id, name: `${member.firstName} ${member.lastName}` }]}
        onClose={() => setReqModal({ open: false })}
        onSaved={load}
      />
      <Modal title="Balance adjustment" open={adjOpen} onCancel={() => setAdjOpen(false)} onOk={() => adjForm.submit()} confirmLoading={saving} destroyOnClose>
        <Form<AdjForm> form={adjForm} layout="vertical" onFinish={addAdjustment} initialValues={{ date: dayjs() }}>
          <Space align="start">
            <Form.Item name="date" label="Date" rules={[{ required: true }]}>
              <DatePicker />
            </Form.Item>
            <Form.Item name="days" label="Days (+/−)" rules={[{ required: true }]}>
              <InputNumber step={0.5} style={{ width: 120 }} />
            </Form.Item>
          </Space>
          <Form.Item name="reason" label="Reason" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
