import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import HomeSection, { type HomeInput } from '../../producer/studio/sections/studio-home';

afterEach(cleanup);

/** The page resolves the census labels from Writer keys; the page head is its own section (sections.studio.page-header). */
const labels = (ready?: { total: number; withCandidate: number; pinned: number }) => ready
  ? { total: `${ready.total} slots`, candidates: `${ready.withCandidate} slots with candidates`, pinned: `${ready.pinned} pinned slots` }
  : { total: 'Designer slot census unavailable', candidates: 'Unavailable', pinned: 'Unavailable' };

const home = (): HomeInput => ({
  agentsLabel: 'Supplied agents',
  agents: [
    { id: 'alpha', label: 'Alpha', purpose: 'Alpha purpose', icon: <svg aria-label="Alpha icon" />, href: '/alpha', openLabel: 'Open Alpha', census: { state: 'ready', total: 70, withCandidate: 23, pinned: 8 }, censusLabels: labels({ total: 70, withCandidate: 23, pinned: 8 }) },
    { id: 'beta', label: 'Beta', purpose: 'Beta purpose', icon: <svg aria-label="Beta icon" />, href: '/beta', openLabel: 'Open Beta', census: { state: 'loading' }, censusLabels: labels() },
    { id: 'gamma', label: 'Gamma', purpose: 'Gamma purpose', icon: <svg aria-label="Gamma icon" />, href: '/gamma', openLabel: 'Open Gamma', census: { state: 'error', message: 'Gamma unavailable detail' }, censusLabels: labels() },
    { id: 'delta', label: 'Delta', purpose: 'Delta purpose', icon: <svg aria-label="Delta icon" />, href: '/delta', openLabel: 'Open Delta', censusLabels: labels() },
  ],
  needs: { title: 'Supplied needs', description: 'Supplied needs detail', empty: 'Supplied empty', closeLabel: 'Close supplied needs', closeIcon: <svg aria-label="Close icon" />, onClose: vi.fn(), rows: [
    { id: 'a', severity: 'Review', tone: 'outline', title: 'First request', detail: 'First request detail' },
    { id: 'b', severity: 'Required', tone: 'destructive', title: 'Second request', detail: 'Second request detail' },
  ] },
});

describe('Home stock data binding', () => {
  it('retains the full agent order, supplied heading, purposes, icons and independent states', () => {
    const { container } = render(<HomeSection home={home()} />);
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Supplied agents');
    const cards = [...container.querySelectorAll('[data-home-agent]')];
    expect(cards.map(card => card.getAttribute('data-home-agent'))).toEqual(['alpha', 'beta', 'gamma', 'delta']);
    expect(cards.map(card => card.getAttribute('data-census-state'))).toEqual(['ready', 'loading', 'error', 'missing']);
    expect(cards.map(card => card.querySelector('[data-slot="card-title"]')?.textContent?.trim())).toEqual(['70', '—', '—', '—']);
    expect(cards[0]!.textContent).toContain('8 pinned slots');
    expect(cards[0]!.querySelector('[aria-label="23 slots with candidates"]')).not.toBeNull();
    for (const [i, label] of ['Alpha', 'Beta', 'Gamma', 'Delta'].entries()) {
      expect(cards[i]!.querySelector(`[aria-label="${label} icon"]`)).not.toBeNull();
      expect(cards[i]!.querySelector('a,button')).toBeNull();
    }
    expect(cards[0]!.textContent).toContain('Alpha purpose');
    expect(cards[1]!.textContent).toContain('Beta purpose');
    expect(cards[2]!.textContent).toContain('Gamma unavailable detail');
    expect(cards[3]!.textContent).toContain('Delta purpose');
  });

  it('preserves every Needs row and invokes the supplied accessible close action', () => {
    const data = home();
    render(<HomeSection home={data} />);
    for (const value of ['Supplied needs', 'Supplied needs detail', 'Review', 'First request', 'First request detail', 'Required', 'Second request', 'Second request detail']) expect(screen.getByText(value)).toBeDefined();
    const close = screen.getByRole('button', { name: 'Close supplied needs' });
    expect(close.querySelector('[aria-label="Close icon"]')).not.toBeNull();
    fireEvent.click(close);
    expect(data.needs!.onClose).toHaveBeenCalledOnce();
  });

  it('retains empty Needs data and leaves no action when Needs is absent', () => {
    const data = home(); data.needs = { ...data.needs!, rows: [] };
    const view = render(<HomeSection home={data} />);
    expect(screen.getByText('Supplied empty')).toBeDefined();
    expect(screen.queryByText('First request')).toBeNull();
    view.rerender(<HomeSection home={{ ...data, needs: undefined }} />);
    expect(screen.queryByRole('button', { name: 'Close supplied needs' })).toBeNull();
    expect(screen.queryByText('Supplied needs')).toBeNull();
  });
});
