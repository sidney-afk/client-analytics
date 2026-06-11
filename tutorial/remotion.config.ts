import {Config} from '@remotion/cli/config';

Config.setVideoImageFormat('jpeg');
Config.setOverwriteOutput(true);
// Font loading via delayRender() can exceed the default 28s when many
// render tabs start at once — give it more headroom.
Config.setTimeoutInMilliseconds(120000);
