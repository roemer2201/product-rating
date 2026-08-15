import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UpdatePrompt } from '@/components/UpdatePrompt';
import { strings } from '@/lib/strings';
import { setOnline } from '@/testing/online';
import { registerSWMock } from '@/testing/pwaRegister';
import { renderWithProviders } from '@/testing/render';

/**
 * The prompt is the only thing standing between a new bundle and a home screen
 * app that would otherwise keep the old one for days. Three properties matter:
 * it stays invisible until there really is something waiting, it never reloads
 * on its own, and it keeps asking the server whether a new version has arrived.
 */

describe('UpdatePrompt', () => {
  it('shows nothing while the installed version is the current one', () => {
    renderWithProviders(<UpdatePrompt />);

    expect(screen.queryByText(strings.update.title)).not.toBeInTheDocument();
  });

  it('offers the update once a new version is waiting', () => {
    registerSWMock.needRefresh = true;

    renderWithProviders(<UpdatePrompt />);

    expect(screen.getByText(strings.update.title)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: strings.update.reload })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: strings.update.later })).toBeInTheDocument();
  });

  it('hands over only when asked to', async () => {
    const updateServiceWorker = vi.fn(() => Promise.resolve());
    registerSWMock.needRefresh = true;
    registerSWMock.updateServiceWorker = updateServiceWorker;

    renderWithProviders(<UpdatePrompt />);

    expect(updateServiceWorker).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: strings.update.reload }));

    expect(updateServiceWorker).toHaveBeenCalledOnce();
  });

  it('lets the offer be put off without touching the waiting worker', async () => {
    const updateServiceWorker = vi.fn(() => Promise.resolve());
    registerSWMock.needRefresh = true;
    registerSWMock.updateServiceWorker = updateServiceWorker;

    renderWithProviders(<UpdatePrompt />);

    await userEvent.click(screen.getByRole('button', { name: strings.update.later }));

    expect(screen.queryByText(strings.update.title)).not.toBeInTheDocument();
    expect(updateServiceWorker).not.toHaveBeenCalled();
  });

  it('asks for a new version when the app comes back to the foreground', () => {
    const update = vi.fn(() => Promise.resolve());
    registerSWMock.registration = { update } as unknown as ServiceWorkerRegistration;

    renderWithProviders(<UpdatePrompt />);

    expect(update).not.toHaveBeenCalled();

    document.dispatchEvent(new Event('visibilitychange'));

    expect(update).toHaveBeenCalledOnce();
  });

  it('does not ask while the phone is offline', () => {
    const update = vi.fn(() => Promise.resolve());
    registerSWMock.registration = { update } as unknown as ServiceWorkerRegistration;

    renderWithProviders(<UpdatePrompt />);
    setOnline(false);

    document.dispatchEvent(new Event('visibilitychange'));

    expect(update).not.toHaveBeenCalled();
  });
});
