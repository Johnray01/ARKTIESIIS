const navigationByRole = {
  database_admin: [
    { id: 'overview', label: 'Overview', href: '/dashboard' },
    { id: 'student-records', label: 'Student records', href: '/records' },
    { id: 'subjects', label: 'Subject catalog', href: '/records/subjects' },
    { id: 'finance', label: 'Finance', href: '/finance' }
  ],
  registrar: [
    { id: 'overview', label: 'Overview', href: '/dashboard' },
    { id: 'student-records', label: 'Student records', href: '/records' },
    { id: 'subjects', label: 'Subject catalog', href: '/records/subjects' }
  ],
  finance: [
    { id: 'finance', label: 'Finance workspace', href: '/finance' }
  ],
  student: [
    { id: 'my-record', label: 'My record', href: '/dashboard/student' }
  ]
};

function buildNavigation(role, currentPath = '') {
  const path = typeof currentPath === 'string' ? currentPath.split('?', 1)[0] : '';
  const items = (navigationByRole[role] || []).map((item) => {
    let current = false;
    if (item.id === 'overview') {
      current = role === 'database_admin'
        ? path === '/admin' || path.startsWith('/admin/users/')
        : role === 'registrar' && path === '/dashboard/registrar';
    } else if (item.id === 'student-records') {
      current = path === '/records' || (path.startsWith('/records/') && !path.startsWith('/records/subjects'));
    } else if (item.id === 'subjects') {
      current = path === '/records/subjects' || path.startsWith('/records/subjects/');
    } else if (item.id === 'finance') {
      current = path === '/finance' || path.startsWith('/finance/');
    } else if (item.id === 'my-record') {
      current = path === '/dashboard/student';
    }
    return { ...item, current };
  });

  return {
    items,
    currentPage: items.find((item) => item.current)?.id || null
  };
}

module.exports = { buildNavigation };
