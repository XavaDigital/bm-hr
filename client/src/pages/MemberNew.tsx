import { useState } from 'react';
import { Typography, App as AntApp } from 'antd';
import { useNavigate } from 'react-router-dom';
import { api, describeError } from '../api';
import { MemberForm, type MemberFormValues } from '../components/MemberForm';
import type { TeamMember } from '../types';

export function MemberNew() {
  const { message } = AntApp.useApp();
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);

  const submit = async (values: MemberFormValues) => {
    setSaving(true);
    try {
      const r = await api<{ member: TeamMember }>('/api/members', { method: 'POST', json: values });
      message.success('Team member added');
      navigate(`/team/${r.member.id}`);
    } catch (e) {
      message.error(describeError(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page">
      <Typography.Title level={3}>Add team member</Typography.Title>
      <MemberForm submitLabel="Add member" saving={saving} onSubmit={submit} onCancel={() => navigate('/team')} />
    </div>
  );
}
