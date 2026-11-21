import { formatSpoilTime, spoilInfo } from './spoilage';

describe('spoilage', () => {
  describe('spoilInfo', () => {
    it('should classify spoil risk', () => {
      expect(spoilInfo('iron-bacteria')).toEqual({
        time: 60,
        risk: 'critical',
      });
      expect(spoilInfo('agricultural-science-pack')?.risk).toEqual('warning');
      expect(spoilInfo('bioflux')?.risk).toEqual('low');
      expect(spoilInfo('agricultural-science-pack(2)')?.time).toEqual(3600);
    });

    it('should return undefined for items that do not spoil', () => {
      expect(spoilInfo('iron-plate')).toBeUndefined();
    });
  });

  describe('formatSpoilTime', () => {
    it('should format seconds, minutes and hours', () => {
      expect(formatSpoilTime(30)).toEqual('30 s');
      expect(formatSpoilTime(90)).toEqual('1.5 min');
      expect(formatSpoilTime(7200)).toEqual('2 h');
    });
  });
});
