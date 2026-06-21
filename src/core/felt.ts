export const isFuzzyColor = (red: number, green: number, blue: number): boolean => {
  const brightest = Math.max(red, green, blue);
  const saturation = brightest - Math.min(red, green, blue);
  const pink = red > blue * 1.08 && red > green * 1.1;
  const cyan = blue > red * 1.08 && blue > green * 1.1;
  return brightest >= 90 && saturation >= 35 && (pink || cyan);
};
