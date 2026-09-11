import { Button, Col, DatePicker, Form, Input, Row, Select, Space } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { STATUS_LABELS, type EmploymentType, type MemberStatus, type TeamMember } from '../types';

export interface MemberFormValues {
  firstName: string;
  lastName: string;
  preferredName?: string | null;
  email?: string | null;
  phone?: string | null;
  country?: string | null;
  timezone?: string | null;
  jobTitle?: string | null;
  employmentType: EmploymentType;
  status: MemberStatus;
  startDate?: string | null;
  endDate?: string | null;
  dateOfBirth?: string | null;
  notes?: string | null;
}

type FormShape = Omit<MemberFormValues, 'startDate' | 'endDate' | 'dateOfBirth'> & {
  startDate?: Dayjs | null;
  endDate?: Dayjs | null;
  dateOfBirth?: Dayjs | null;
};

const toDayjs = (d: string | null | undefined) => (d ? dayjs(d) : null);
const toIso = (d: Dayjs | null | undefined) => (d ? d.format('YYYY-MM-DD') : '');

export function MemberForm({
  initial,
  submitLabel,
  saving,
  onSubmit,
  onCancel,
}: {
  initial?: Partial<TeamMember>;
  submitLabel: string;
  saving: boolean;
  onSubmit: (values: MemberFormValues) => void;
  onCancel?: () => void;
}) {
  const [form] = Form.useForm<FormShape>();
  const initialValues: FormShape = {
    firstName: initial?.firstName ?? '',
    lastName: initial?.lastName ?? '',
    preferredName: initial?.preferredName ?? null,
    email: initial?.email ?? null,
    phone: initial?.phone ?? null,
    country: initial?.country ?? null,
    timezone: initial?.timezone ?? null,
    jobTitle: initial?.jobTitle ?? null,
    employmentType: initial?.employmentType ?? 'contractor',
    status: initial?.status ?? 'active',
    startDate: toDayjs(initial?.startDate),
    endDate: toDayjs(initial?.endDate),
    dateOfBirth: toDayjs(initial?.dateOfBirth),
    notes: initial?.notes ?? null,
  };

  return (
    <Form<FormShape>
      form={form}
      layout="vertical"
      initialValues={initialValues}
      onFinish={(v) =>
        onSubmit({
          ...v,
          email: v.email?.trim() || null,
          startDate: toIso(v.startDate),
          endDate: toIso(v.endDate),
          dateOfBirth: toIso(v.dateOfBirth),
        })
      }
    >
      <Row gutter={16}>
        <Col xs={24} md={8}>
          <Form.Item name="firstName" label="First name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
        </Col>
        <Col xs={24} md={8}>
          <Form.Item name="lastName" label="Last name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
        </Col>
        <Col xs={24} md={8}>
          <Form.Item name="preferredName" label="Preferred name">
            <Input />
          </Form.Item>
        </Col>
        <Col xs={24} md={8}>
          <Form.Item name="email" label="Email" rules={[{ type: 'email' }]}>
            <Input />
          </Form.Item>
        </Col>
        <Col xs={24} md={8}>
          <Form.Item name="phone" label="Phone">
            <Input />
          </Form.Item>
        </Col>
        <Col xs={24} md={8}>
          <Form.Item name="jobTitle" label="Role / job title">
            <Input />
          </Form.Item>
        </Col>
        <Col xs={24} md={8}>
          <Form.Item name="country" label="Country">
            <Input placeholder="PH, NZ, …" />
          </Form.Item>
        </Col>
        <Col xs={24} md={8}>
          <Form.Item name="timezone" label="Timezone">
            <Input placeholder="Asia/Manila" />
          </Form.Item>
        </Col>
        <Col xs={24} md={8}>
          <Form.Item name="employmentType" label="Employment type">
            <Select
              options={[
                { value: 'contractor', label: 'Contractor' },
                { value: 'employee', label: 'Employee' },
              ]}
            />
          </Form.Item>
        </Col>
        <Col xs={24} md={8}>
          <Form.Item name="status" label="Status">
            <Select options={(Object.keys(STATUS_LABELS) as MemberStatus[]).map((s) => ({ value: s, label: STATUS_LABELS[s] }))} />
          </Form.Item>
        </Col>
        <Col xs={24} md={8}>
          <Form.Item name="startDate" label="Start date">
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
        </Col>
        <Col xs={24} md={8}>
          <Form.Item name="endDate" label="End date">
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
        </Col>
        <Col xs={24} md={8}>
          <Form.Item name="dateOfBirth" label="Date of birth">
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
        </Col>
        <Col xs={24}>
          <Form.Item name="notes" label="Notes">
            <Input.TextArea rows={4} />
          </Form.Item>
        </Col>
      </Row>
      <Space>
        <Button type="primary" htmlType="submit" loading={saving}>
          {submitLabel}
        </Button>
        {onCancel && <Button onClick={onCancel}>Cancel</Button>}
      </Space>
    </Form>
  );
}
