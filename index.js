'use strict';

/*
 * @Author: daycool
 * @Date:   2018-04-10 12:12:03
 * @Last Modified by: daycool
 * @Last Modified time: 2019-02-27 15:24:56
 */

const nunjucks = require('nunjucks');
const fs = require('fs');
const path = require('path');
const prettier = require('prettier');
const mkdirp = require('mkdirp');
const _ = require('lodash');
const glob = require('glob');

const { HjsonData, hjsonStrToObj } = require('hjson2');

let appPath = '';

nunjucks.configure({
  autoescape: false,
  tags: {
    blockStart: '<%',
    blockEnd: '%>',
    variableStart: '<$',
    variableEnd: '$>',
    commentStart: '<#',
    commentEnd: '#>',
  },
});

async function outputPage(
  pageData,
  appData,
  scaffoldData,
  interData,
  templateData,
  componentsData,
  scaffoldDir
) {
  appPath = path.join(scaffoldDir, scaffoldData.name);

  if (!appPath) {
    console.log('appPath不存在');
    return;
  }
  let pagePath = pageData.path;
  // let templateId = getTemplateId(pageData)
  let appId = pageData.app_id;
  let service = getServiceInfo(pageData, interData);
  pageData.service = service;
  appData.page.forEach(item => {
    item.service = getServiceInfo(item, interData);
  });
  let renderTemplateOption = {
    // templateId: templateId,
    // appId: appId,
    // pageId: pageId,
    appData: appData,
    scaffold: scaffoldData,
    pageData: pageData,
    interData: interData,
    service: service,
    templateData,
    componentsData,
  };

  // if(!pageId){
  //   renderTemplateOption.pageData = pageData;
  // }
  // let appData = await getAppData.bind(this)(appId);
  // let scaffoldData = await getScaffoldData.bind(this)(appData.scaffold_id);
  let previewFile = getPreviewFile(pagePath, scaffoldData);

  let outputRenderTemplate = await renderTemplate(renderTemplateOption);

  let previewTemplate = prettierTemplate(outputRenderTemplate);

  await buildPreviewFile(previewFile, previewTemplate);

  let previewUrl = getPreviewurl(pagePath, scaffoldData);

  return previewUrl;
}

async function outputConfigFile(
  pageData,
  appData,
  scaffoldData,
  interData,
  scaffoldDir
) {
  let renderData = {
    pageData: pageData,
    appData: appData,
    scaffoldData: scaffoldData,
    interData: interData,
  };

  const promises = scaffoldData.extra_template.map(async item => {
    let extraTemplateFile = getExtraTemplateFile(item, renderData);
    let renderExtraTemplate = renderCommonTempate(item.template, renderData);
    await buildTemplateFile(extraTemplateFile, renderExtraTemplate);
  });
  await Promise.all(promises);
}

function getExtraTemplateFile(extraTemplate, renderData) {
  // let renderExtraTemplate = renderCommonTempate();
  var name = nunjucks.renderString(extraTemplate.name, renderData);
  var extraTemplateFile = path.join(appPath, extraTemplate.dir, name);
  return extraTemplateFile;
}
function getPreviewFile(path, scaffoldData) {
  var dirname = appPath;
  var scaffoldDir = dirname + '/' + scaffoldData.name;
  var previewFile = appPath + scaffoldData.page_dir + path + '.js';
  return previewFile;
}

function getPreviewurl(path, scaffoldData) {
  return '/scaffold/' + scaffoldData.name + '/#' + path;
}

function toTreeData(
  templateHjson,
  reqHjson,
  resHjson,
  componentsData,
  templateData
) {
  // 模版
  // const templateComments = templateHjson.getRootCommentJson()
  const template = templateData;
  let data = {
    ...template,
    fieldName: 'template',
    children: [],
  };
  const reqRootComponent = getRootData(reqHjson, componentsData);
  const resRootComponent = getRootData(resHjson, componentsData);
  data.children = [reqRootComponent, resRootComponent];

  return data;
}

function getRootData(hjson, componentsData) {
  // 根组件
  const rootComponentComments = hjson.getRootCommentJson();
  const component = getComponentData(rootComponentComments, componentsData);
  const rootComponent = {
    ...component,
    fieldName: 'rootComponent',
    children: [],
  };
  const rootComponentChildren = rootComponent.children;
  getData(hjson, hjson.obj, [], componentsData, rootComponentChildren);
  return rootComponent;
}

function getData(hjson, value, paths, componentsData, parentChildren) {
  // 根组件
  // const rootComponentComments = hjson.getRootCommentJson()
  // const component = getComponentData(rootComponentComments, componentsData)
  // const rootComponent = {
  //   ...component,
  //   fieldName: 'rootComponent',
  //   children: []
  // }
  // const rootComponentChildren = rootComponent.children
  // templateChildren.push(rootComponent)

  // 子孙组件
  // const value = hjson.getVar(paths)
  Object.keys(value).forEach(fieldName => {
    const newPaths = paths.concat(fieldName);
    const newValue = hjson.getVar(newPaths);
    const fieldComments = hjson.getCommentJson(newPaths);
    const newComponent = getComponentData(fieldComments, componentsData);
    const children = [];
    parentChildren.push({
      ...newComponent,
      ...fieldComments,
      fieldName: fieldName,
      children,
    });
    if (typeof newValue === 'object') {
      getData(hjson, newValue, newPaths, componentsData, children);
    }
  });
}

function getComponentData(comments, componentsData, uiType = 'ui') {
  const ui = comments[uiType];
  if (ui) {
    const componentName = ui.__componentName;
    const componentCustomExtraField = ui;

    const component = getComponentByName(componentName, componentsData);
    Object.keys(componentCustomExtraField).forEach(extraFieldName => {
      component.extra_field.forEach(extraField => {
        if (extraFieldName === extraField.name) {
          extraField.value =
            componentCustomExtraField[extraFieldName] ||
            comments[extraFieldName];
        }
      });
    });
    return component;
  } else {
    return {};
  }
}

/**
 * 页面预览可能没有页面id所以需要传pageData
 */
async function renderTemplate(options) {
  // 修改content为tree 组件模式，有子组件render
  // let data = options.pageData.page_template[0].content

  let appData = options.appData;
  let service = options.service;
  let scaffold = options.scaffold;
  let interData = options.interData;
  let templateData = options.templateData;
  let componentsData = options.componentsData;

  let templateHjson = new HjsonData().parse(options.interData.comments);
  let reqHjson = new HjsonData().parse(options.interData.req);
  let resHjson = new HjsonData().parse(options.interData.res);
  let data = toTreeData(
    templateHjson,
    reqHjson,
    resHjson,
    componentsData,
    templateData
  );

  let outputTemplate = render(
    data,
    null,
    null,
    appData,
    scaffold,
    interData,
    service,
    templateData,
    componentsData
  );

  return outputTemplate;
}

function getServiceInfo(pageData, interData) {
  // let tempalte = pageData.page_template[0]

  let service = {
    name: pageData.path.replace(/^\/+/, '').replace(/\//g, '_'),
    url: interData.url,
    reqData: interData.req,
    resData: interData.res,
    resDataData: JSON.stringify(hjsonStrToObj(interData.res).data),
    method: interData.method,
    label: interData.label,
  };

  return service;
}

function renderExtraField(extraFieldData, render) {
  return extraFieldName => {
    let template = ``;
    let extraField = null;
    let realExtraFieldData = extraFieldData;
    if (extraFieldName) {
      extraField = extraFieldData.find(item => item.name == extraFieldName);
      realExtraFieldData = [extraField];
    }

    realExtraFieldData.forEach(item => {
      let valueStartSymbol = '{';
      let valueEndSymbol = '}';
      let value = '';
      if (item.value_type == 'string') {
        valueStartSymbol = '"';
        valueEndSymbol = '"';
      } else if (item.value_type == 'reactnode') {
        valueStartSymbol = '{(';
        valueEndSymbol = ')}';
      }

      if (typeof item.value === 'undefined') {
        value = item.default_value;
      } else {
        value = item.value;
      }

      template +=
        ' ' + item.name + '=' + valueStartSymbol + value + valueEndSymbol;
    });

    return render({ template });
  };
}

function renderCommonTempate(tmpl, data) {
  let template = nunjucks.renderString(tmpl, data);
  return template;
}

function getComponentByName(name, componentList) {
  let component = componentList.find(item => item.name == name);
  if (component) {
    return _.clone(component);
  }

  console.error('没有此组件：', name);
  return {};
}

async function buildPreviewFile(filePath, template) {
  let dir = path.dirname(filePath);
  return new Promise((resolve, reject) => {
    mkdirp(dir, function(err) {
      if (err) console.error(err);

      resolve();
      fs.writeFileSync(filePath, template);
    });
  });
}

async function buildTemplateFile(filePath, template) {
  let dir = path.dirname(filePath);
  return new Promise((resolve, reject) => {
    mkdirp(dir, function(err) {
      if (err) console.error(err);

      fs.writeFileSync(filePath, template);
      resolve();
    });
  });
}

function prettierTemplate(template) {
  let prettierTemplate = '';
  try {
    prettierTemplate = prettier.format(template, {
      semi: true,
      jsxBracketSameLine: true,
    });
  } catch (e) {
    prettierTemplate = template;
    console.error(e);
  }
  return prettierTemplate;
}

function arrToMap(arr, key) {
  var map = {};
  key = key || 'id';
  arr.forEach(item => {
    map[item[key]] = item;
  });
  return map;
}

async function dirTree(dir, cwd, cb) {
  const options = {
    cwd: cwd,
    matchBase: true,
    ignore: ['.', '**/node_modules/**/*.*'],
  };

  return new Promise((resolve, reject) => {
    glob(dir, options, function(er, files) {
      resolve(files);
      if (cb) {
        cb(files);
      }
    });
  });
}

function getDirFiles(cwd, dir, cb, ignore) {
  dir = dir || '';
  let dirPath = path.join(cwd, dir);
  return new Promise((resolve, reject) => {
    fs.readdir(dirPath, function(err, files) {
      if (!err) {
        let filesArr = [];

        files.forEach(item => {
          let fileInfo = {};

          fileInfo.name = item;
          fileInfo.fullName = path.join(dir, item);
          let realFilePath = path.join(dirPath, item);
          fileInfo.realFilePath = realFilePath;
          fileInfo.isFile = fs.statSync(realFilePath).isFile();

          filesArr.push(fileInfo);
          // console.log(fs.statSync(item))
        });
        // console.log(filesArr)
        resolve(filesArr);
        if (cb) {
          cb(filesArr);
        }
      } else {
        reject(err);
      }
    });
  });
}

async function getFileContent(file, cb) {
  return new Promise((resolve, reject) => {
    fs.readFile(file, 'utf8', function(er, content) {
      resolve(content);
      if (cb) {
        cb(content);
      }
    });
  });
}

function render(
  data,
  parentData,
  parentsData,
  appData,
  scaffold,
  interData,
  service,
  templateData,
  componentsData
) {
  parentData = parentData || data;
  parentsData = parentsData || [data];
  if (data.extra_field) {
    data.extraField = arrToMap(data.extra_field, 'name'); // 扩展字段
  }

  let outputTemplate = '';
  if (data.template) {
    outputTemplate = nunjucks.renderString(data.template, {
      appData: appData,
      scaffold: scaffold,
      interData: interData,
      service: service,
      data: data,
      extraField: data.extraField,
      extraFieldMap: data.extraFieldMap,
      parentData: parentData,
      parentsData: parentsData,
      templateData,
      componentsData,

      renderComponent: () => {
        let outputTemplate = '';
        // data.children &&
        data.children.forEach(item => {
          outputTemplate += render(
            item,
            data,
            parentsData.concat(item),
            appData,
            scaffold,
            interData,
            service
          );
        });
        return outputTemplate;
      },
      renderExtraField: renderExtraField(data.extra_field, item => {
        console.log('TCL: item', item, data);
        const outputTemplate = render(
          item,
          data,
          parentsData.concat(item),
          appData,
          scaffold,
          interData,
          service
        );
        return outputTemplate;
      }),
      renderValid: function(validName) {
        let template = '';
        data.rules.forEach(item => {
          template += `{pattern: ${item.rule}, message: "${item.error_msg}"},`;
        });
        return template;
      },
    });
  } else {
    data.children &&
      data.children.forEach(item => {
        outputTemplate += render(
          item,
          parentData,
          parentsData,
          appData,
          scaffold,
          interData,
          service,
          templateData,
          componentsData
        );
      });
  }

  // console.log(outputTemplate)
  return outputTemplate;
}

module.exports = {
  outputPage: outputPage,
  outputConfigFile: outputConfigFile,
  getDirFiles: getDirFiles,
  dirTree: dirTree,
  getFileContent: getFileContent,
};
