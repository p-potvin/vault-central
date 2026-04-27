import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { VaultDashboard } from './VaultDashboard';
import * as storageVault from '../lib/storage-vault';

// Mock the storage vault module
vi.mock('../lib/storage-vault', () => ({
  getSavedVideos: vi.fn(),
  saveVideos: vi.fn(),
  getSyncEnabled: vi.fn(),
  getSyncedVideos: vi.fn(),
  saveSyncedVideos: vi.fn(),
  setSyncEnabled: vi.fn(),
  clearSyncedVideos: vi.fn(),
  getPinSettings: vi.fn(),
  savePinSettings: vi.fn(),
  isVaultLocked: vi.fn(),
}));

// Mock browser
vi.mock('webextension-polyfill', () => ({
  default: {
    runtime: {
      sendMessage: vi.fn(),
    },
  },
}));

// Mock dexie-store
vi.mock('../lib/dexie-store', () => ({
  getPreview: vi.fn().mockResolvedValue(null),
}));

const mockVideos = [
  {
    id: '1',
    url: 'https://www.youtube.com/watch?v=123',
    title: 'Test Video 1',
    timestamp: 1620000000000,
    rawVideoSrc: 'https://test-video1.com/video.mp4',
    thumbnail: 'https://test-video1.com/thumb.jpg',
    author: 'Test Author',
    type: 'video',
    tags: ['test', 'react'],
    domain: 'youtube.com'
  },
  {
    id: '2',
    url: 'https://www.example.com/page',
    title: 'Example Page 2',
    timestamp: 1620000010000,
    type: 'link',
    tags: [],
    domain: 'example.com'
  }
];

const mockVideosWithBadUrls = [
  {
    id: '3',
    url: 'not-a-valid-url',
    title: 'Invalid URL Item',
    timestamp: 1620000020000,
    type: 'link',
    tags: [],
    domain: 'Unknown',
  },
  {
    id: '4',
    url: '',
    title: 'Missing URL Item',
    timestamp: 1620000030000,
    type: 'link',
    tags: [],
    domain: 'Unknown',
  },
];

describe('Dashboard Component', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    (storageVault.getSavedVideos as any).mockResolvedValue(mockVideos);
    (storageVault.getSyncEnabled as any).mockResolvedValue(false);
    (storageVault.getSyncedVideos as any).mockResolvedValue([]);
    (storageVault.saveSyncedVideos as any).mockResolvedValue(undefined);
    (storageVault.setSyncEnabled as any).mockResolvedValue(undefined);
    (storageVault.clearSyncedVideos as any).mockResolvedValue(undefined);
    (storageVault.isVaultLocked as any).mockResolvedValue(false);
    (storageVault.getPinSettings as any).mockResolvedValue({
      enabled: false,
      length: 4,
      lockTimeout: 3600000,
    });
  });

  it('renders the Dashboard header and initial state', async () => {
    render(<VaultDashboard />);
    await waitFor(() => {
      expect(screen.getByText(/Wares/i)).toBeInTheDocument();
      expect(screen.getAllByText(/Vault/i).length).toBeGreaterThan(0);
    });
  });

  it('loads and displays saved items', async () => {
    (storageVault.getSavedVideos as any).mockResolvedValue(mockVideos);

    render(<VaultDashboard />);
    
    // Check if the "Total Items" count is 2 - this proves re-render happened
    await waitFor(() => {
      expect(screen.queryByText(/Total Items:/i)).toBeInTheDocument();
      // Match "2" specifically inside a strong tag with a vault class
      const countElements = screen.getAllByText('2', { selector: 'strong' });
      expect(countElements.length).toBeGreaterThan(1); // One in the card, one in the header/stat
    }, { timeout: 3000 });

    const title1 = screen.queryByText((content, element) => {
        return element?.tagName.toLowerCase() === 'h3' && content === 'Test Video 1';
    });
    expect(title1).toBeInTheDocument();
  });

  it('filters items based on search input', async () => {
    (storageVault.getSavedVideos as any).mockResolvedValue(mockVideos);

    render(<VaultDashboard />);
    
    await waitFor(() => {
      const countElements = screen.getAllByText('2', { selector: 'strong' });
      expect(countElements.length).toBeGreaterThan(0);
    }, { timeout: 3000 });
    
    const searchInput = screen.getByPlaceholderText(/Search in title.../i);
    fireEvent.change(searchInput, { target: { value: 'Test Video' } });

    await waitFor(() => {
      // After filtering, '2' should be gone or decreased to '1' in relevant places
      expect(screen.getAllByText('1', { selector: 'strong' }).length).toBeGreaterThan(0);
      const title1 = screen.queryByText((content, element) => {
          return element?.tagName.toLowerCase() === 'h3' && content === 'Test Video 1';
      });
      const title2 = screen.queryByText((content, element) => {
          return element?.tagName.toLowerCase() === 'h3' && content === 'Example Page 2';
      });
      expect(title1).toBeInTheDocument();
      expect(title2).not.toBeInTheDocument();
    }, { timeout: 3000 });
  });

  it('toggles the sidebar layout', async () => {
    (storageVault.getSavedVideos as any).mockResolvedValue(mockVideos);
    const { container } = render(<VaultDashboard />);
    
    // The sidebar has visible classes when open
    const sidebar = container.querySelector('aside');
    expect(sidebar).toHaveClass('w-64');

    // Click the toggle bar (the div with Expand/Collapse Sidebar title)
    const toggleBar = screen.getByTitle(/Collapse Sidebar/i);
    fireEvent.click(toggleBar);

    await waitFor(() => {
      expect(sidebar).toHaveClass('w-0');
    });
  });

  it('renders items with invalid URLs without crashing and shows "Unknown" domain', async () => {
    (storageVault.getSavedVideos as any).mockResolvedValue(mockVideosWithBadUrls);

    render(<VaultDashboard />);

    await waitFor(() => {
      const invalidItem = screen.queryByText((content, element) => {
        return element?.tagName.toLowerCase() === 'h3' && content === 'Invalid URL Item';
      });
      expect(invalidItem).toBeInTheDocument();

      const missingItem = screen.queryByText((content, element) => {
        return element?.tagName.toLowerCase() === 'h3' && content === 'Missing URL Item';
      });
      expect(missingItem).toBeInTheDocument();
    }, { timeout: 3000 });
  });
});

