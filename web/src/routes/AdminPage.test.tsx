import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { AdminLayout } from '@/components/AdminLayout';
import { AdminCategoriesPage } from '@/routes/AdminCategoriesPage';
import { AdminInvitesPage } from '@/routes/AdminInvitesPage';
import { AdminPage } from '@/routes/AdminPage';
import { AdminTrashPage } from '@/routes/AdminTrashPage';
import { AdminUsersPage } from '@/routes/AdminUsersPage';
import { strings } from '@/lib/strings';
import { mockFetch, testUser } from '@/testing/fetchMock';
import { CATEGORY_LIST, makeCategory } from '@/testing/fixtures';
import { renderWithProviders } from '@/testing/render';

/**
 * The administration: the overview, categories, invites, users and the trash.
 * Everything here is behind the administrator role.
 */

const ADMIN = { ...testUser, id: 'admin-1', username: 'chef', role: 'admin' as const };

const INVITES = {
  path: '/invites',
  body: {
    invites: [
      {
        code: 'A1B2-C3D4-E5F6',
        note: 'Für Bert',
        createdBy: ADMIN.id,
        createdAt: '2026-08-14T10:00:00.000Z',
        expiresAt: '2026-08-21T10:00:00.000Z',
        usedBy: null,
        usedAt: null,
        status: 'open',
      },
      {
        code: 'Z9Y8-X7W6-V5U4',
        note: null,
        createdBy: ADMIN.id,
        createdAt: '2026-07-01T10:00:00.000Z',
        expiresAt: '2026-07-08T10:00:00.000Z',
        usedBy: 'anna',
        usedAt: '2026-07-02T10:00:00.000Z',
        status: 'used',
      },
    ],
  },
};

const USERS = {
  path: '/users',
  body: { users: [ADMIN, { ...testUser, username: 'anna' }] },
};

const TRASH = {
  path: '/trash',
  body: {
    entries: [
      {
        product: {
          id: 'prod-9',
          ean: '4260000000011',
          name: 'Apfelsaft',
          brand: 'Bio Hof',
          categories: [{ id: 'cat-drinks', name: 'Getränke' }],
          notes: null,
          createdBy: ADMIN.id,
          createdAt: '2026-08-01T10:00:00.000Z',
          updatedAt: '2026-08-10T10:00:00.000Z',
        },
        deletedAt: '2026-08-14T10:00:00.000Z',
        deletedBy: ADMIN.id,
        deletedByUsername: 'chef',
        ratings: 2,
        photos: 1,
      },
    ],
  },
};

const CATEGORIES = { path: '/categories', body: { categories: CATEGORY_LIST } };

/** The routes as `App` has them, starting on one screen of the administration. */
function renderAdmin(route = '/admin') {
  return renderWithProviders(
    <Routes>
      <Route path="/admin" element={<AdminLayout />}>
        <Route index element={<AdminPage />} />
        <Route path="categories" element={<AdminCategoriesPage />} />
        <Route path="invites" element={<AdminInvitesPage />} />
        <Route path="users" element={<AdminUsersPage />} />
        <Route path="trash" element={<AdminTrashPage />} />
      </Route>
      <Route path="/settings" element={<p>Einstellungen</p>} />
    </Routes>,
    { route },
  );
}

/** The JSON body of the first request matching a path and a method. */
function bodyOf(fetchMock: ReturnType<typeof mockFetch>, path: string, method: string): unknown {
  const call = fetchMock.mock.calls.find(
    ([url, init]) => String(url).endsWith(path) && (init as RequestInit)?.method === method,
  );
  return call === undefined ? undefined : JSON.parse(String((call[1] as RequestInit).body));
}

describe('the administration', () => {
  it('sends anyone without the role back to the settings', async () => {
    mockFetch([{ path: '/auth/me', body: { user: testUser } }]);

    renderAdmin();

    expect(await screen.findByText('Einstellungen')).toBeInTheDocument();
  });

  it('guards the screens behind the overview as well', async () => {
    mockFetch([{ path: '/auth/me', body: { user: testUser } }]);

    renderAdmin('/admin/categories');

    expect(await screen.findByText('Einstellungen')).toBeInTheDocument();
  });

  it('leads from the overview to each screen and back', async () => {
    const user = userEvent.setup();
    mockFetch([{ path: '/auth/me', body: { user: ADMIN } }, CATEGORIES]);

    renderAdmin();

    expect(await screen.findByRole('heading', { name: strings.admin.title })).toBeInTheDocument();
    for (const title of [
      strings.admin.categoriesTitle,
      strings.admin.invitesTitle,
      strings.admin.usersTitle,
      strings.admin.trashTitle,
    ]) {
      expect(screen.getByRole('link', { name: new RegExp(title) })).toBeInTheDocument();
    }
    // The overview is where "back" leads, so it offers none itself.
    expect(screen.queryByRole('link', { name: strings.admin.back })).not.toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: new RegExp(strings.admin.categoriesTitle) }));
    expect(
      await screen.findByRole('heading', { name: strings.admin.categoriesTitle }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: strings.admin.back }));
    expect(await screen.findByRole('heading', { name: strings.admin.title })).toBeInTheDocument();
  });

  it('lists invites with their state', async () => {
    mockFetch([{ path: '/auth/me', body: { user: ADMIN } }, INVITES, USERS, TRASH]);

    renderAdmin('/admin/invites');

    expect(await screen.findByText('A1B2-C3D4-E5F6')).toBeInTheDocument();
    expect(screen.getByText(strings.admin.inviteStatusOpen)).toBeInTheDocument();
    expect(screen.getByText(strings.admin.inviteStatusUsed)).toBeInTheDocument();
    expect(screen.getByText(/Für Bert/)).toBeInTheDocument();
    // A code that has been used cannot be withdrawn or shared any more.
    expect(screen.getAllByRole('button', { name: strings.admin.inviteRevoke })).toHaveLength(1);
  });

  it('creates an invite with the note that was typed', async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch([
      { path: '/auth/me', body: { user: ADMIN } },
      { path: '/invites', method: 'POST', body: { invite: INVITES.body.invites[0] } },
      INVITES,
      USERS,
      TRASH,
    ]);

    renderAdmin('/admin/invites');
    await screen.findByText('A1B2-C3D4-E5F6');

    await user.type(screen.getByLabelText(new RegExp(strings.admin.inviteNote)), 'Für Clara');
    await user.click(screen.getByRole('button', { name: strings.admin.inviteCreate }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        ([url, init]) =>
          String(url).endsWith('/invites') && (init as RequestInit)?.method === 'POST',
      );
      expect(JSON.parse(String((post?.[1] as RequestInit).body))).toEqual({ note: 'Für Clara' });
    });
  });

  it('lists the trash with what a restore would bring back', async () => {
    mockFetch([{ path: '/auth/me', body: { user: ADMIN } }, INVITES, USERS, TRASH]);

    renderAdmin('/admin/trash');

    expect(await screen.findByText('Apfelsaft')).toBeInTheDocument();
    expect(screen.getByText(/2 Bewertungen, 1 Foto/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: strings.admin.trashRestore })).toBeInTheDocument();
  });

  it('asks a second time before a product is gone for good', async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch([
      { path: '/auth/me', body: { user: ADMIN } },
      { path: '/trash/prod-9', method: 'DELETE', body: { ok: true } },
      INVITES,
      USERS,
      TRASH,
    ]);

    renderAdmin('/admin/trash');
    await screen.findByText('Apfelsaft');

    await user.click(screen.getByRole('button', { name: strings.admin.trashPurge }));
    // The first tap only arms the button; nothing has left the server yet.
    expect(
      fetchMock.mock.calls.some(([, init]) => (init as RequestInit)?.method === 'DELETE'),
    ).toBe(false);

    await user.click(screen.getByRole('button', { name: strings.admin.trashPurgeConfirm }));

    await waitFor(() => {
      const purge = fetchMock.mock.calls.find(
        ([url, init]) =>
          String(url).endsWith('/trash/prod-9') && (init as RequestInit)?.method === 'DELETE',
      );
      expect(purge).toBeDefined();
    });
  });

  it('shows a password link once and marks the account that needs one', async () => {
    const user = userEvent.setup();
    mockFetch([
      { path: '/auth/me', body: { user: ADMIN } },
      {
        path: '/users',
        body: {
          users: [ADMIN, { ...testUser, username: 'anna', passwordResetRequired: true }],
        },
      },
      {
        path: `/users/${testUser.id}/reset-link`,
        method: 'POST',
        body: {
          link: {
            username: 'anna',
            token: 'a'.repeat(43),
            url: `http://localhost/reset?token=${'a'.repeat(43)}`,
            expiresAt: '2026-08-24T10:00:00.000Z',
          },
        },
      },
      INVITES,
      TRASH,
    ]);

    renderAdmin('/admin/users');

    // The account that arrived without a password says so.
    expect(await screen.findByText(strings.admin.userNeedsPassword)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: strings.admin.userResetLink }));

    // On screen, not only in the clipboard: without a secure context there is
    // no clipboard, and the link still has to get out.
    expect(await screen.findByText(/\/reset\?token=a{43}/)).toBeInTheDocument();
    expect(screen.getByText(strings.admin.userResetLinkFor('anna'))).toBeInTheDocument();
  });

  it('copies a registration link rather than the bare code', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });

    mockFetch([{ path: '/auth/me', body: { user: ADMIN } }, INVITES, USERS, TRASH]);

    renderAdmin('/admin/invites');
    await screen.findByText('A1B2-C3D4-E5F6');

    await user.click(screen.getByRole('button', { name: strings.admin.inviteCopyLink }));

    await waitFor(() => {
      // The link carries the code into the form, so nobody types it out.
      expect(writeText).toHaveBeenCalledWith(
        expect.stringContaining('/register?invite=A1B2-C3D4-E5F6'),
      );
    });
    expect(await screen.findByText(strings.common.copied)).toBeInTheDocument();
  });

  it('says so when the clipboard refuses instead of pretending', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('navigator', {
      ...navigator,
      clipboard: { writeText: vi.fn(() => Promise.reject(new Error('denied'))) },
    });

    mockFetch([{ path: '/auth/me', body: { user: ADMIN } }, INVITES, USERS, TRASH]);

    renderAdmin('/admin/invites');
    await screen.findByText('A1B2-C3D4-E5F6');

    await user.click(screen.getByRole('button', { name: strings.admin.inviteCopyLink }));

    expect(await screen.findByText(strings.common.copyFailed)).toBeInTheDocument();
  });

  it('sets a new password for another account', async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch([
      { path: '/auth/me', body: { user: ADMIN } },
      { path: '/users/user-1/password', method: 'POST', body: { ok: true, revokedSessions: 1 } },
      INVITES,
      USERS,
      TRASH,
    ]);

    renderAdmin('/admin/users');
    await screen.findByText('anna');

    // The field only appears once the action has been chosen; a password box
    // next to every account invites accidents.
    expect(screen.queryByLabelText(strings.fields.newPassword)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: strings.admin.userResetPassword }));

    await user.type(screen.getByLabelText(strings.fields.newPassword), 'ein-neues-passwort');
    await user.click(screen.getByRole('button', { name: strings.admin.userResetSubmit }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(([url]) =>
        String(url).includes('/users/user-1/password'),
      );
      expect(JSON.parse(String((post?.[1] as RequestInit).body))).toEqual({
        newPassword: 'ein-neues-passwort',
      });
    });

    expect(await screen.findByText(strings.admin.userResetDone)).toBeInTheDocument();
  });

  it('changes another account but offers nothing on your own', async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch([
      { path: '/auth/me', body: { user: ADMIN } },
      { path: '/users/user-1', method: 'PATCH', body: { user: testUser } },
      INVITES,
      USERS,
      TRASH,
    ]);

    renderAdmin('/admin/users');
    await screen.findByText('anna');

    // Locking yourself out of your own instance is not a feature.
    expect(screen.getByText(strings.admin.userSelf)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: strings.admin.userDisable })).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: strings.admin.userMakeAdmin }));

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(
        ([, init]) => (init as RequestInit)?.method === 'PATCH',
      );
      expect(JSON.parse(String((patch?.[1] as RequestInit).body))).toEqual({ role: 'admin' });
    });
  });
});

describe('the category list', () => {
  it('lists every entry with its products and its mark', async () => {
    mockFetch([{ path: '/auth/me', body: { user: ADMIN } }, CATEGORIES]);

    renderAdmin('/admin/categories');

    expect(await screen.findByText('Vegan')).toBeInTheDocument();
    expect(screen.getByText(strings.admin.categoryProducts(1))).toBeInTheDocument();
    expect(
      screen.getByRole('checkbox', { name: strings.admin.categoryFrequentFor('Getränke') }),
    ).toBeChecked();
    expect(
      screen.getByRole('checkbox', { name: strings.admin.categoryFrequentFor('Vegan') }),
    ).not.toBeChecked();
  });

  it('creates a category, marked as frequent if asked to', async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch([
      { path: '/auth/me', body: { user: ADMIN } },
      {
        path: '/categories',
        method: 'POST',
        status: 201,
        body: { category: makeCategory({ id: 'cat-new', name: 'Tiefkühl', frequent: true }) },
      },
      CATEGORIES,
    ]);

    renderAdmin('/admin/categories');
    await screen.findByText('Vegan');

    await user.type(screen.getByLabelText(new RegExp(strings.admin.categoryNew)), '  Tiefkühl ');
    await user.click(screen.getByRole('checkbox', { name: strings.admin.categoryFrequent }));
    await user.click(screen.getByRole('button', { name: strings.admin.categoryCreate }));

    await waitFor(() => {
      expect(bodyOf(fetchMock, '/categories', 'POST')).toEqual({
        name: 'Tiefkühl',
        frequent: true,
      });
    });
  });

  it('says so when the name is taken', async () => {
    const user = userEvent.setup();
    mockFetch([
      { path: '/auth/me', body: { user: ADMIN } },
      {
        path: '/categories',
        method: 'POST',
        status: 409,
        body: { error: { code: 'conflict', message: 'taken', details: { field: 'name' } } },
      },
      CATEGORIES,
    ]);

    renderAdmin('/admin/categories');
    await screen.findByText('Vegan');

    await user.type(screen.getByLabelText(new RegExp(strings.admin.categoryNew)), 'vegan');
    await user.click(screen.getByRole('button', { name: strings.admin.categoryCreate }));

    expect(await screen.findByText(strings.errors.categoryNameTaken)).toBeInTheDocument();
  });

  it('marks an entry as frequent with one tap', async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch([
      { path: '/auth/me', body: { user: ADMIN } },
      {
        path: '/categories/cat-vegan',
        method: 'PATCH',
        body: { category: makeCategory({ id: 'cat-vegan', name: 'Vegan', frequent: true }) },
      },
      CATEGORIES,
    ]);

    renderAdmin('/admin/categories');
    await screen.findByText('Vegan');

    await user.click(
      screen.getByRole('checkbox', { name: strings.admin.categoryFrequentFor('Vegan') }),
    );

    await waitFor(() => {
      expect(bodyOf(fetchMock, '/categories/cat-vegan', 'PATCH')).toEqual({ frequent: true });
    });
  });

  it('renames an entry', async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch([
      { path: '/auth/me', body: { user: ADMIN } },
      {
        path: '/categories/cat-vegan',
        method: 'PATCH',
        body: { category: makeCategory({ id: 'cat-vegan', name: 'Pflanzlich' }) },
      },
      CATEGORIES,
    ]);

    renderAdmin('/admin/categories');
    await screen.findByText('Vegan');

    await user.click(
      screen.getByRole('button', { name: strings.admin.categoryRenameFor('Vegan') }),
    );
    const field = screen.getByLabelText(strings.admin.categoryName);
    expect(field).toHaveValue('Vegan');
    await user.clear(field);
    await user.type(field, 'Pflanzlich');
    await user.click(screen.getByRole('button', { name: strings.admin.categoryRenameSubmit }));

    await waitFor(() => {
      expect(bodyOf(fetchMock, '/categories/cat-vegan', 'PATCH')).toEqual({ name: 'Pflanzlich' });
    });
    await waitFor(() => {
      expect(screen.queryByLabelText(strings.admin.categoryName)).not.toBeInTheDocument();
    });
  });

  it('asks a second time, naming the products, before it deletes', async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch([
      { path: '/auth/me', body: { user: ADMIN } },
      { path: '/categories/cat-drinks', method: 'DELETE', body: { ok: true, removedFrom: 1 } },
      CATEGORIES,
    ]);

    renderAdmin('/admin/categories');
    await screen.findByText('Vegan');

    await user.click(
      screen.getByRole('button', { name: strings.admin.categoryDeleteFor('Getränke') }),
    );
    // The first tap only arms the button and says what it is about to do.
    expect(
      fetchMock.mock.calls.some(([, init]) => (init as RequestInit)?.method === 'DELETE'),
    ).toBe(false);

    await user.click(screen.getByRole('button', { name: strings.admin.categoryDeleteConfirm(1) }));

    expect(
      await screen.findByText(strings.admin.categoryDeleted('Getränke', 1)),
    ).toBeInTheDocument();
  });
});
