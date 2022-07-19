---
layout: post
title:  "关于Javascript的深拷贝"
date:   2022-07-19 14:46:11 +0800
categories: Javascript
---

### 先从堆和栈聊起

```JavaScript
// 堆（字符串、整型，布尔型）
var a = 1
var b = a

a = 2
console.log(b)

// 栈（对象、数组）
var obj1 = {name: "a"}
var obj2 = obj1

obj1.name = "b"
console.log(obj2)

var arr1 = [1,2,3]
var arr2 = arr1

arr1[0] = 999
console.log(arr2)
```

### assign, concat

```JavaScript
var obj1 = {name: "a"}
var obj2 = Object.assign({}, obj1) // 此处注意空对象在前的顺序

obj1.name = "b"
console.log(obj2)

var arr1 = [1,2,3]
var arr2 = arr1.concat([]) // 数组不用在意拼接顺序

arr1[0] = 999
console.log(arr2)
```

### 嵌套对象

```javascript
var obj1 = {name: {first: "a", last: "b"}}
var obj2 = Object.assign({}, obj1)

obj1.name.first = "c"
console.log(obj2)

var arr1 = [[11, 22, 33],2,3]
var arr2 = arr1.concat([])

arr1[0][0] = 999
console.log(arr2)
```

### JSON.parse(JSON.stringify())

```javascript
var obj1 = {name: {first: "a", last: "b"}}
var obj2 = JSON.parse(JSON.stringify(obj1))

obj1.name.first = "c"
console.log(obj2)

// 特殊的undefined
var obj3 = {name: {first: undefined, last: "b"}}
var obj4 = JSON.parse(JSON.stringify(obj3))

console.log(obj4) // {name: {last: 'b'}}
```

### 递归
```javascript
function deepClone(source) {
  if (!source && typeof source !== 'object') {
    throw new Error('error arguments', 'deepClone')
  }
  const targetObj = source.constructor === Array ? [] : {}
  Object.keys(source).forEach(keys => {
    if (source[keys] && typeof source[keys] === 'object') {
      targetObj[keys] = deepClone(source[keys])
    } else {
      targetObj[keys] = source[keys]
    }
  })
  return targetObj
}
```

写在最后：在使用深拷贝的时候，多问一句自己：“真的需要吗？存在两个一摸一样的对象？”

