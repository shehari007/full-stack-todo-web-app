'use client';

/**
 * Ant Design icons, re-exported across a client boundary.
 *
 * A server component cannot import `@ant-design/icons` directly. Its entry
 * module runs `React.createContext` at the top level, and `createContext` is
 * not exported by React's `react-server` build, so the import crashes the
 * whole route during module evaluation with
 * "(0 , _react.createContext) is not a function", which surfaces as a 500 for
 * every visitor rather than as a build error.
 *
 * Nothing is lost by routing them through here: `AntdIcon`, which every icon
 * renders, is itself a `'use client'` module, so the icons were always going to
 * be client components. This only moves the package's module evaluation to the
 * side of the boundary that has a full React.
 *
 * Client components may keep importing `@ant-design/icons` directly.
 */
export {
  AreaChartOutlined,
  ArrowDownOutlined,
  ArrowRightOutlined,
  ArrowUpOutlined,
  BehanceOutlined,
  BorderOutlined,
  CheckCircleFilled,
  CheckCircleOutlined,
  CheckSquareOutlined,
  ClockCircleOutlined,
  ControlOutlined,
  DatabaseOutlined,
  DiscordOutlined,
  DribbbleOutlined,
  ExclamationCircleOutlined,
  FacebookOutlined,
  FilePdfOutlined,
  FireOutlined,
  GithubOutlined,
  GitlabOutlined,
  GlobalOutlined,
  InstagramOutlined,
  LinkOutlined,
  LinkedinOutlined,
  MailOutlined,
  MastodonFilled,
  MediumOutlined,
  MinusCircleOutlined,
  MinusOutlined,
  PaperClipOutlined,
  RedditOutlined,
  SafetyCertificateOutlined,
  SlackOutlined,
  TelegramFilled,
  ThreadsFilled,
  TikTokOutlined,
  TwitterOutlined,
  XOutlined,
  YoutubeOutlined,
} from '@ant-design/icons';
