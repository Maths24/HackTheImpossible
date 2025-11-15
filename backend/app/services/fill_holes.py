import math
# [x,y,z]
p = [0, -1]
n = [0, 2]
border = [
    [0,]
]
#v = B - A = (Bx - Ax, By - Ay)
#L = |v| = sqrt((Bx - Ax)^2 + (By - Ay)^2)
#u = v / L  (normierter Richtungsvektor)
def vector(p: [], n: []):
    v = [n[0] - p[0], n[1] - p[1]]
    L = math.sqrt((n[0] - p[0]) ** 2 + (n[1] - p[1]) ** 2)
    return [v[0]/L, v[1]/L]

print(vector(p, n))

