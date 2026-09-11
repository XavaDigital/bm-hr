import { useCallback, useEffect, useState } from 'react';
import { Button, Descriptions, Popconfirm, Space, Spin, Tabs, Tag, Typography, App as AntApp } from 'antd';
import { DeleteOutlined } from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import { api, describeError } from '../api';
import { MemberForm, type MemberFormValues } from '../components/MemberForm';
import { CompensationTab } from '../components/CompensationTab';
import { PayScheduleTab } from '../components/PayScheduleTab';
import { PayHistoryTab } from '../components/PayHistoryTab';
import { date, fullName, pay, sinceRelative, tenure } from '../format';
import { STATUS_LABELS, type MemberDetail, type TeamMember } from '../types';

export function MemberDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { message } = AntApp.useApp();
  const navigate = useNavigate();
  const [data, setData] = useState<MemberDetail | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api<MemberDetail>(`/api/members/${id}`));
    } catch (e) {
      message.error(describeError(e));
      navigate('/team');
    }
  }, [id, message, navigate]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!data) {
    return (
      <div className="page">
        <Spin />
      </div>
    );
  }
  const m = data.member;

  const save = async (values: MemberFormValues) => {
    setSaving(true);
    try {
      await api<{ member: TeamMember }>(`/api/members/${m.id}`, { method: 'PATCH', json: values });
      message.success('Saved');
      await load();
    } catch (e) {
      message.error(describeError(e));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    try {
      await api(`/api/members/${m.id}`, { method: 'DELETE' });
      message.success('Removed');
      navigate('/team');
    } catch (e) {
      message.error(describeError(e));
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>
            {fullName(m)} <Tag style={{ marginLeft: 8, verticalAlign: 'middle' }}>{STATUS_LABELS[m.status]}</Tag>
          </Typography.Title>
          <Typography.Text className="muted">
            {[m.jobTitle, m.country, m.email].filter(Boolean).join(' · ')}
          </Typography.Text>
        </div>
        <Space>
          <Popconfirm title="Remove this team member?" description="They will disappear from the directory. History is kept." onConfirm={remove}>
            <Button danger icon={<DeleteOutlined />}>
              Remove
            </Button>
          </Popconfirm>
        </Space>
      </div>

      <Descriptions size="small" column={{ xs: 1, md: 4 }} style={{ marginBottom: 16 }}>
        <Descriptions.Item label="Current pay">{pay(data.currentPay)}</Descriptions.Item>
        <Descriptions.Item label="Last pay rise">
          {data.lastPayRise ? `${date(data.lastPayRise.effectiveFrom)} (${sinceRelative(data.lastPayRise.effectiveFrom)})` : '—'}
        </Descriptions.Item>
        <Descriptions.Item label="Started">
          {date(m.startDate)}
          {data.tenureMonths !== null ? ` · ${tenure(data.tenureMonths)}` : ''}
        </Descriptions.Item>
        <Descriptions.Item label="Next anniversary">
          {data.nextAnniversary ? `${date(data.nextAnniversary)} (${data.daysToAnniversary}d)` : '—'}
        </Descriptions.Item>
      </Descriptions>

      <Tabs
        items={[
          {
            key: 'details',
            label: 'Details',
            children: <MemberForm key={m.updatedAt} initial={m} submitLabel="Save" saving={saving} onSubmit={save} />,
          },
          {
            key: 'compensation',
            label: `Compensation (${data.compensation.length})`,
            children: <CompensationTab memberId={m.id} rows={data.compensation} onChange={load} />,
          },
          {
            key: 'schedule',
            label: 'Pay schedule',
            children: <PayScheduleTab memberId={m.id} schedule={data.schedule} member={m} onChange={load} />,
          },
          {
            key: 'history',
            label: 'Pay history',
            children: <PayHistoryTab memberId={m.id} />,
          },
        ]}
      />
    </div>
  );
}
